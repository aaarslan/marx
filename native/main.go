package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/aaarslan/marx/native/engine"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

//go:embed all:frontend/dist
var assets embed.FS

type DesktopService struct {
	dialogMu sync.Mutex
	app      *application.App
	win      *application.WebviewWindow
	notifier *notifications.NotificationService
	engine   *engine.Engine
	ready    chan struct{}
	startErr error
	stopOnce sync.Once
}

func jsonValue(value any) []byte { b, _ := json.Marshal(value); return b }
func (s *DesktopService) start(profile string) error {
	s.engine, s.startErr = engine.Open(profile, engine.Host{Native: s.native, Emit: func(event engine.Object) { s.app.Event.Emit("scan:event", event) }, Protect: protectCredential, Guard: containProcess, Downloads: downloadsDirectory()})
	close(s.ready)
	if s.startErr == nil {
		s.engine.Recover()
	}
	return s.startErr
}
func (s *DesktopService) Invoke(channel string, args []json.RawMessage) (json.RawMessage, error) {
	select {
	case <-s.ready:
	case <-time.After(20 * time.Second):
		return nil, errors.New("The scan engine is starting")
	}
	if s.startErr != nil {
		return nil, errors.New("The workbench could not be opened")
	}
	value, err := s.engine.Invoke(channel, args)
	if err != nil {
		return jsonValue(map[string]any{"ok": false, "error": err.Error()}), nil
	}
	return jsonValue(map[string]any{"ok": true, "data": value}), nil
}
func (s *DesktopService) stop() {
	s.stopOnce.Do(func() {
		select {
		case <-s.ready:
			if s.engine != nil {
				s.engine.Close()
			}
		case <-time.After(20 * time.Second):
		}
	})
}
func (s *DesktopService) native(name string, values engine.Object) (any, error) {
	if name == "open" || name == "save" {
		if !s.dialogMu.TryLock() {
			return nil, errors.New("A native dialog is already open.")
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
	data := jsonValue(values)
	json.Unmarshal(data, &p)
	var value any
	var err error
	switch name {
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
	return value, err
}
func downloadsDirectory() string {
	if directory, err := windowsDownloadsDirectory(); err == nil {
		return directory
	}
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
	canonical, err := filepath.EvalSymlinks(profile)
	if err != nil {
		os.Exit(1)
	}
	profile, err = filepath.Abs(canonical)
	if err != nil {
		os.Exit(1)
	}
	identity := sha256.Sum256([]byte(strings.ToLower(profile)))
	s := &DesktopService{ready: make(chan struct{}), notifier: notifications.New()}
	s.app = application.New(application.Options{Name: "Marx", Windows: browserOptions(), Description: "Checkmarx One desktop client", Services: []application.Service{application.NewService(s), application.NewService(s.notifier)}, Assets: application.AssetOptions{Handler: application.AssetFileServerFS(assets), Middleware: secureAssets}, OnShutdown: s.stop, SingleInstance: &application.SingleInstanceOptions{UniqueID: "com.marx.scanner." + hex.EncodeToString(identity[:8]), OnSecondInstanceLaunch: func(application.SecondInstanceData) {
		if s.win != nil {
			s.win.Show()
			s.win.Focus()
		}
	}}})
	s.notifier.OnNotificationResponse(func(result notifications.NotificationResult) {
		if result.Error == nil {
			select {
			case <-s.ready:
				if s.engine != nil {
					s.engine.NotificationClick(result.Response.ID)
				}
			default:
			}
		}
	})
	s.win = s.app.Window.NewWithOptions(application.WebviewWindowOptions{Title: "Marx", Width: 1280, Height: 840, MinWidth: 960, MinHeight: 640, BackgroundColour: application.NewRGB(23, 24, 28), URL: "/", EnableFileDrop: true})
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
