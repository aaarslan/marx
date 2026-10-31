package main

import (
	"bufio"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

//go:embed all:frontend/dist
var assets embed.FS

type wireMessage struct {
	ID      uint64          `json:"id"`
	Channel string          `json:"channel,omitempty"`
	Args    json.RawMessage `json:"args,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   string          `json:"error,omitempty"`
	Native  string          `json:"native,omitempty"`
	Event   string          `json:"event,omitempty"`
	Ready   bool            `json:"ready,omitempty"`
	Reply   bool            `json:"reply,omitempty"`
}

type DesktopService struct {
	dialogMu sync.Mutex
	app      *application.App
	win      *application.WebviewWindow
	notifier *notifications.NotificationService
	cmd      *exec.Cmd
	input    io.WriteCloser
	writeMu  sync.Mutex
	mu       sync.Mutex
	pending  map[uint64]chan wireMessage
	sequence atomic.Uint64
	ready    chan struct{}
	done     chan struct{}
	stopOnce sync.Once
	job      io.Closer
}

func (s *DesktopService) start(profile string) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	core := filepath.Join(filepath.Dir(executable), "marx-core.exe")
	s.cmd = exec.Command(core)
	s.cmd.Env = append(os.Environ(), "MARX_USER_DATA_DIR="+profile, "MARX_HOST_EXECUTABLE="+executable, "MARX_DOWNLOADS_DIR="+downloadsDirectory())
	hideProcess(s.cmd)
	s.input, err = s.cmd.StdinPipe()
	if err != nil {
		return err
	}
	output, err := s.cmd.StdoutPipe()
	if err != nil {
		return err
	}
	s.cmd.Stderr = io.Discard
	if err = s.cmd.Start(); err != nil {
		close(s.done)
		return errors.New("The scan engine could not start. Reinstall Marx.")
	}
	s.job, err = containProcess(s.cmd)
	if err != nil {
		s.cmd.Process.Kill()
		s.cmd.Wait()
		close(s.done)
		return errors.New("The scan engine could not be isolated.")
	}
	go func() {
		scanner := bufio.NewScanner(output)
		scanner.Buffer(make([]byte, 65536), 96*1024*1024)
		for scanner.Scan() {
			var m wireMessage
			if json.Unmarshal(scanner.Bytes(), &m) != nil {
				break
			}
			if m.Ready {
				select {
				case <-s.ready:
				default:
					close(s.ready)
				}
				continue
			}
			if m.Event != "" {
				var data any
				json.Unmarshal(m.Data, &data)
				s.app.Event.Emit(m.Event, data)
				continue
			}
			if m.Native != "" {
				go s.native(m)
				continue
			}
			s.mu.Lock()
			c := s.pending[m.ID]
			delete(s.pending, m.ID)
			s.mu.Unlock()
			if c != nil {
				c <- m
			}
		}
		s.cmd.Wait()
		close(s.done)
	}()
	select {
	case <-s.ready:
		return nil
	case <-s.done:
		return errors.New("The scan engine stopped during startup.")
	case <-time.After(20 * time.Second):
		s.stop()
		return errors.New("The scan engine did not become ready.")
	}
}
func (s *DesktopService) write(m wireMessage) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return json.NewEncoder(s.input).Encode(m)
}

func (s *DesktopService) Invoke(channel string, args []json.RawMessage) (json.RawMessage, error) {
	if strings.HasPrefix(channel, "$") {
		return nil, errors.New("Reserved operation.")
	}
	select {
	case <-s.ready:
	case <-s.done:
		return nil, errors.New("The scan engine is unavailable. Restart Marx.")
	case <-time.After(20 * time.Second):
		return nil, errors.New("The scan engine is starting.")
	}
	id := s.sequence.Add(1)
	c := make(chan wireMessage, 1)
	s.mu.Lock()
	if len(s.pending) >= 256 {
		s.mu.Unlock()
		return nil, errors.New("Too many pending operations.")
	}
	s.pending[id] = c
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.pending, id); s.mu.Unlock() }()
	payload, _ := json.Marshal(args)
	if err := s.write(wireMessage{ID: id, Channel: channel, Args: payload}); err != nil {
		return nil, errors.New("The scan engine is unavailable.")
	}
	select {
	case m := <-c:
		if m.Error != "" {
			return nil, errors.New(m.Error)
		}
		if len(m.Result) == 0 {
			return json.RawMessage("null"), nil
		}
		return m.Result, nil
	case <-s.done:
		return nil, errors.New("The scan engine stopped. Restart Marx.")
	case <-time.After(31 * time.Minute):
		return nil, errors.New("The desktop operation timed out.")
	}
}
func (s *DesktopService) stop() {
	s.stopOnce.Do(func() {
		if s.input == nil {
			return
		}
		s.write(wireMessage{Channel: "$shutdown"})
		s.input.Close()
		select {
		case <-s.done:
		case <-time.After(5 * time.Second):
			s.cmd.Process.Kill()
		}
		if s.job != nil {
			s.job.Close()
		}
	})
}
func (s *DesktopService) native(m wireMessage) {
	if m.Native == "open" || m.Native == "save" {
		if !s.dialogMu.TryLock() {
			s.write(wireMessage{ID: m.ID, Reply: true, Error: "A native dialog is already open."})
			return
		}
		defer s.dialogMu.Unlock()
	}

	var p struct {
		ID          string   `json:"id"`
		Text        string   `json:"text"`
		URL         string   `json:"url"`
		File        string   `json:"file"`
		Title       string   `json:"title"`
		Body        string   `json:"body"`
		DefaultPath string   `json:"defaultPath"`
		Properties  []string `json:"properties"`
	}
	json.Unmarshal(m.Args, &p)
	var value any
	var err error
	switch m.Native {
	case "clipboard":
		if !s.app.Clipboard.SetText(p.Text) {
			err = errors.New("The clipboard could not be written.")
		}
	case "show":
		s.win.Show()
		s.win.Focus()
	case "external":
		var u *url.URL
		u, err = url.Parse(p.URL)
		if err == nil {
			if u.Scheme != "https" && u.Scheme != "vscode" && u.Scheme != "cursor" {
				err = errors.New("Unsupported external link.")
			} else {
				err = s.app.Browser.OpenURL(p.URL)
			}
		}
	case "reveal":
		err = s.app.Env.OpenFileManager(p.File, true)
	case "open":
		directory := false
		for _, v := range p.Properties {
			if v == "openDirectory" {
				directory = true
			}
		}
		var selected string
		selected, err = s.app.Dialog.OpenFile().CanChooseDirectories(directory).CanChooseFiles(!directory).SetTitle(p.Title).AttachToWindow(s.win).PromptForSingleSelection()
		paths := []string{}
		if selected != "" {
			paths = append(paths, selected)
		}
		value = map[string]any{"canceled": selected == "", "filePaths": paths}
	case "save":
		var selected string
		selected, err = s.app.Dialog.SaveFile().SetDirectory(filepath.Dir(p.DefaultPath)).SetFilename(filepath.Base(p.DefaultPath)).AttachToWindow(s.win).PromptForSingleSelection()
		value = map[string]any{"canceled": selected == "", "filePath": selected}
	case "notification":
		err = s.notifier.SendNotification(notifications.NotificationOptions{ID: p.ID, Title: p.Title, Body: p.Body})
	default:
		err = errors.New("Unknown native operation.")
	}
	data, _ := json.Marshal(value)
	reply := wireMessage{ID: m.ID, Reply: true, Data: data}
	if err != nil {
		reply.Error = "The native desktop operation could not be completed."
	}
	s.write(reply)
}
func downloadsDirectory() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Downloads")
}
func secureAssets(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Header.Get("Sec-Fetch-Dest") == "iframe" || r.Header.Get("Sec-Fetch-Dest") == "frame" {
			http.Error(w, "Embedded pages are disabled.", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func main() {
	if len(os.Args) == 3 && os.Args[1] == "--credential" {
		if credentialCommand(os.Args[2]) != nil {
			os.Exit(1)
		}
		return
	}
	profile := os.Getenv("MARX_USER_DATA_DIR")
	if profile == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			os.Exit(1)
		}
		profile = filepath.Join(base, "MarxWails")
	}
	if err := os.MkdirAll(profile, 0700); err != nil {
		os.Exit(1)
	}
	identity := sha256.Sum256([]byte(profile))
	s := &DesktopService{pending: make(map[uint64]chan wireMessage), ready: make(chan struct{}), done: make(chan struct{}), notifier: notifications.New()}
	s.app = application.New(application.Options{Name: "Marx", Windows: browserOptions(), Description: "Checkmarx One desktop client", Services: []application.Service{application.NewService(s), application.NewService(s.notifier)}, Assets: application.AssetOptions{Handler: application.AssetFileServerFS(assets), Middleware: secureAssets}, OnShutdown: s.stop, SingleInstance: &application.SingleInstanceOptions{UniqueID: "com.marx.scanner." + hex.EncodeToString(identity[:8]), OnSecondInstanceLaunch: func(application.SecondInstanceData) {
		if s.win != nil {
			s.win.Show()
			s.win.Focus()
		}
	}}})
	s.notifier.OnNotificationResponse(func(result notifications.NotificationResult) {
		if result.Error == nil {
			payload, _ := json.Marshal([]string{result.Response.ID})
			s.write(wireMessage{Channel: "$notification-click", Args: payload})
		}
	})
	s.win = s.app.Window.NewWithOptions(application.WebviewWindowOptions{Title: "Marx", Width: 1280, Height: 840, MinWidth: 960, MinHeight: 640, BackgroundColour: application.NewRGB(23, 24, 28), URL: "/", EnableFileDrop: true, KeyBindings: map[string]func(application.Window){"Ctrl+O": func(application.Window) { s.app.Event.Emit("menu:action", "open-folder") }, "Ctrl+R": func(application.Window) { s.app.Event.Emit("menu:action", "run-scan") }}})
	s.win.OnWindowEvent(events.Common.WindowFilesDropped, func(e *application.WindowEvent) {
		files := e.Context().DroppedFiles()
		if len(files) == 1 {
			payload, _ := json.Marshal(files[0])
			go func() {
				result, err := s.Invoke("fs:authorize-folder", []json.RawMessage{payload})
				if err == nil {
					var value struct {
						OK   bool   `json:"ok"`
						Data string `json:"data"`
					}
					if json.Unmarshal(result, &value) == nil && value.OK {
						s.app.Event.Emit("source:dropped", value.Data)
					}
				}
			}()
		}
	})
	go func() {
		if err := s.start(profile); err != nil {
			s.app.Dialog.Error().SetTitle("Marx startup failed").SetMessage(err.Error()).Show()
			s.app.Quit()
		}
	}()
	if err := s.app.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "Marx could not start.")
		os.Exit(1)
	}
}
