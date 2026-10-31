package engine

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

type Host struct {
	Native    func(string, Object) (any, error)
	Emit      func(Object)
	Protect   func(string, []byte) ([]byte, error)
	Guard     ProcessGuard
	Downloads string
}
type activeJob struct {
	cancel context.CancelFunc
	client *CLI
	job    Object
}
type importTask struct {
	canceled bool
	done     chan struct{}
	cancel   context.CancelFunc
	readers  map[string]bool
	page     Object
	err      error
}
type Engine struct {
	mu                sync.Mutex
	settingsMu        sync.Mutex
	sessionMu         sync.Mutex
	profile           string
	host              Host
	store             *Store
	settings          Object
	folders           map[string]bool
	active            map[string]*activeJob
	imports           map[string]*importTask
	requests          map[string]*importTask
	capacity, control chan struct{}
	queue             chan struct{}
	ctx               context.Context
	cancel            context.CancelFunc
	wg                sync.WaitGroup
	closed            bool
	pending           int
	batch             bool
	preparing         map[string]bool
	canceled          map[string]bool
}

func Open(profile string, host Host) (*Engine, error) {
	store, err := OpenStore(filepath.Join(profile, "workbench.sqlite"))
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	e := &Engine{profile: profile, host: host, store: store, folders: map[string]bool{}, active: map[string]*activeJob{}, imports: map[string]*importTask{}, requests: map[string]*importTask{}, queue: make(chan struct{}, 128), capacity: make(chan struct{}, 10), control: make(chan struct{}, 2), ctx: ctx, cancel: cancel, preparing: map[string]bool{}, canceled: map[string]bool{}}
	e.settings = defaultSettings()
	data, err := readBounded(filepath.Join(profile, "settings.json"), 1<<20)
	if err == nil {
		var saved Object
		if json.Unmarshal(data, &saved) != nil {
			store.Close()
			cancel()
			return nil, errors.New("Settings are unreadable; the file was left unchanged")
		}
		mergeSettings(e.settings, saved)
	} else if !os.IsNotExist(err) {
		store.Close()
		cancel()
		return nil, errors.New("Settings could not be read; the file was left unchanged")
	}
	for _, folder := range stringsOf(e.settings["recentFolders"]) {
		e.grant(folder)
	}
	jobs, err := store.list("job", nil)
	if err != nil {
		store.Close()
		cancel()
		return nil, err
	}
	for _, job := range jobs {
		e.grant(str(job, "folderPath"))
		if number(job["finishedAt"]) == 0 {
			job["status"] = "Unknown"
			job["monitoringStatus"] = "stopped"
			job["finishedAt"] = now()
			job["error"] = "Local monitoring was interrupted. Reconcile known scan IDs; check Checkmarx One before retrying an uncertain submission."
			job["progress"] = Object{"phase": "failed", "detail": job["error"]}
			if err = store.saveJob(job); err != nil {
				store.Close()
				cancel()
				return nil, err
			}
		}
	}
	bindings, err := store.list("binding", nil)
	if err != nil {
		store.Close()
		cancel()
		return nil, err
	}
	for _, b := range bindings {
		e.grant(str(b, "folderPath"))
	}
	return e, nil
}
func (e *Engine) Recover() {
	c, err := e.client()
	if err != nil {
		return
	}
	jobs, err := e.store.list("job", &c.connection)
	if err != nil {
		return
	}
	for _, job := range jobs {
		if str(job, "status") == "Unknown" && str(job, "scanId") != "" {
			_, _ = e.startJob(job, c, true)
		}
	}
}
func (e *Engine) Close() {
	e.mu.Lock()
	if e.closed {
		e.mu.Unlock()
		return
	}
	e.closed = true
	e.cancel()
	for _, job := range e.active {
		job.cancel()
	}
	for _, task := range e.imports {
		task.cancel()
	}
	e.mu.Unlock()
	e.wg.Wait()
	e.store.Close()
}
func defaultSettings() Object {
	return Object{"cliPath": "", "cliConfigPath": "", "cliAuthMode": "cli", "baseUrl": "", "tenant": "", "recentFolders": []string{}, "defaults": Object{"scanners": []string{"sast", "sca"}, "sastPreset": "Checkmarx Default", "sastIncremental": true, "scaExploitablePath": false, "excludeNodeModules": true, "extraExcludes": []string{}, "batchConcurrency": 2}}
}
func mergeSettings(current, next Object) {
	for _, k := range []string{"cliPath", "cliConfigPath", "cliAuthMode", "baseUrl", "tenant", "recentFolders"} {
		if next[k] != nil {
			current[k] = next[k]
		}
	}
	defaults := object(current["defaults"])
	for k, v := range object(next["defaults"]) {
		defaults[k] = v
	}
	current["defaults"] = defaults
}
func (e *Engine) getSettings() Object {
	e.settingsMu.Lock()
	defer e.settingsMu.Unlock()
	s := clone(e.settings)
	available := false
	if e.host.Protect != nil {
		_, err := e.host.Protect("protect", []byte("storage-check"))
		available = err == nil
	}
	stat, err := os.Stat(filepath.Join(e.profile, "settings.key"))
	stored := err == nil && stat.Size() > 0
	s["credentialStorageAvailable"] = available
	s["hasStoredApiKey"] = stored
	s["hasApiKey"] = available && stored
	return s
}
func writePrivate(file string, data []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(file), ".marx-*.tmp")
	if err != nil {
		return errors.New("Private data could not be saved")
	}
	name := temp.Name()
	defer os.Remove(name)
	if err = temp.Chmod(0600); err == nil {
		_, err = temp.Write(data)
	}
	if err == nil {
		err = temp.Sync()
	}
	closeErr := temp.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, file)
	}
	if err != nil {
		return errors.New("Private data could not be saved; existing data was left in place")
	}
	return nil
}
func (e *Engine) saveSettings(next Object) (Object, error) {
	e.settingsMu.Lock()
	updated := clone(e.settings)
	mergeSettings(updated, next)
	if mode := str(updated, "cliAuthMode"); mode != "cli" && mode != "marx" {
		e.settingsMu.Unlock()
		return nil, errors.New("Choose a supported CLI authentication mode")
	}
	for _, k := range []string{"cliPath", "cliConfigPath", "baseUrl", "tenant"} {
		if _, err := bounded(updated[k], k, 4096); err != nil {
			e.settingsMu.Unlock()
			return nil, err
		}
	}
	if err := writePrivate(filepath.Join(e.profile, "settings.json"), jsonValue(updated)); err != nil {
		e.settingsMu.Unlock()
		return nil, err
	}
	e.settings = updated
	e.settingsMu.Unlock()
	return e.getSettings(), nil
}
func (e *Engine) setKey(key string) (Object, error) {
	if len(key) > 1<<20 {
		return nil, errors.New("Credential exceeds its size limit")
	}
	data := []byte{}
	if key != "" {
		if e.host.Protect == nil {
			return nil, errors.New("Protected credential storage is unavailable")
		}
		var err error
		data, err = e.host.Protect("protect", []byte(key))
		if err != nil || len(data) == 0 {
			return nil, errors.New("Credential encryption failed; existing key was left unchanged")
		}
	}
	e.settingsMu.Lock()
	err := writePrivate(filepath.Join(e.profile, "settings.key"), data)
	e.settingsMu.Unlock()
	if err != nil {
		return nil, err
	}
	return e.getSettings(), nil
}
func (e *Engine) client() (*CLI, error) {
	e.settingsMu.Lock()
	settings := clone(e.settings)
	var key string
	if str(settings, "cliAuthMode") == "marx" {
		blob, err := readBounded(filepath.Join(e.profile, "settings.key"), 2<<20)
		if err != nil || len(blob) == 0 || e.host.Protect == nil {
			e.settingsMu.Unlock()
			return nil, errors.New("A protected API key is required")
		}
		plain, err := e.host.Protect("unprotect", blob)
		if err != nil {
			e.settingsMu.Unlock()
			return nil, errors.New("The saved credential cannot be decrypted; replace it or use CLI configuration")
		}
		key = string(plain)
		for i := range plain {
			plain[i] = 0
		}
	}
	e.settingsMu.Unlock()
	return newCLI(settings, key, e.host.Guard, e.capacity, e.control, e.queue)
}
func (e *Engine) connection(local bool) (string, error) {
	c, err := e.client()
	if err == nil {
		err = e.store.save(record{kind: "workspace", id: "_connection", value: Object{"connectionId": c.connection}})
		return c.connection, err
	}
	if local {
		saved, readErr := e.store.get("workspace", "", "_connection")
		if readErr == nil && str(saved, "connectionId") != "" {
			return str(saved, "connectionId"), nil
		}
	}
	return "", err
}
func (e *Engine) checkConnection(c *CLI) error {
	current, err := e.client()
	if err != nil {
		return err
	}
	if current.connection != c.connection {
		return errors.New("CLI connection changed; reload the workspace before continuing")
	}
	return nil
}
func (e *Engine) emit(event Object) {
	if e.host.Emit != nil {
		e.host.Emit(clone(event))
	}
}
func (e *Engine) native(name string, p Object) (any, error) {
	if e.host.Native == nil {
		return nil, errors.New("This operation requires the native desktop")
	}
	return e.host.Native(name, p)
}
