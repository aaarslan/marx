package engine

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

type ProcessGuard func(*exec.Cmd) (io.Closer, error)
type CLI struct {
	executable, config, connection, authMode string
	env                                      []string
	secrets                                  []string
	guard                                    ProcessGuard
	capacity, control                        chan struct{}
	queue                                    chan struct{}
}

var defaultExcludes = []string{".git", "node_modules", "__pycache__", ".venv", "venv", ".idea", ".DS_Store", "dist", "build", "target", ".next", "out", "coverage", ".turbo", ".gradle"}

func newCLI(settings Object, key string, guard ProcessGuard, capacity, control, queue chan struct{}) (*CLI, error) {
	path := str(settings, "cliPath")
	if path == "" {
		path = "cx"
		if runtime.GOOS == "windows" {
			path += ".exe"
		}
	}
	if strings.ContainsAny(path, "\x00\r\n") {
		return nil, errors.New("Choose a valid CLI executable")
	}
	if !filepath.IsAbs(path) && strings.ContainsAny(path, "/\\") {
		return nil, errors.New("The CLI executable path must be absolute")
	}
	executable, err := exec.LookPath(path)
	if err != nil {
		return nil, errors.New("The official Checkmarx CLI was not found; select its executable in Settings")
	}
	executable, err = filepath.Abs(executable)
	if err != nil {
		return nil, err
	}
	if runtime.GOOS == "windows" && !strings.EqualFold(filepath.Ext(executable), ".exe") {
		return nil, errors.New("Select a Windows executable for the official CLI")
	}
	config := str(settings, "cliConfigPath")
	if config != "" && !filepath.IsAbs(config) {
		return nil, errors.New("The CLI configuration path must be absolute")
	}
	envMap := map[string]string{}
	for _, entry := range os.Environ() {
		k, v, ok := strings.Cut(entry, "=")
		if ok {
			if runtime.GOOS == "windows" {
				k = strings.ToUpper(k)
			}
			envMap[k] = v
		}
	}
	auth := str(settings, "cliAuthMode")
	if auth == "marx" {
		if key == "" {
			return nil, errors.New("Save an API key or use the CLI's existing configuration")
		}
		envMap["CX_APIKEY"] = key
		delete(envMap, "CX_CLIENT_ID")
		delete(envMap, "CX_CLIENT_SECRET")
		if v := str(settings, "baseUrl"); v != "" {
			envMap["CX_BASE_URI"] = v
		}
		if v := str(settings, "tenant"); v != "" {
			envMap["CX_TENANT"] = v
		}
	}
	c := &CLI{executable: executable, config: config, authMode: auth, guard: guard, capacity: capacity, control: control, queue: queue}
	cx := []string{}
	for k, v := range envMap {
		c.env = append(c.env, k+"="+v)
		if v != "" && (strings.Contains(strings.ToUpper(k), "KEY") || strings.Contains(strings.ToUpper(k), "SECRET") || strings.Contains(strings.ToUpper(k), "TOKEN") || strings.Contains(strings.ToUpper(k), "PASSWORD")) {
			c.secrets = append(c.secrets, v)
		}
		if strings.HasPrefix(k, "CX_") {
			cx = append(cx, k+"="+v)
		}
	}
	sort.Slice(c.secrets, func(i, j int) bool { return len(c.secrets[i]) > len(c.secrets[j]) })
	sort.Strings(cx)
	configFile := config
	if configFile == "" {
		configFile = envMap["CX_CONFIG_FILE_PATH"]
	}
	if configFile == "" {
		home, _ := os.UserHomeDir()
		configFile = filepath.Join(home, ".checkmarx", "checkmarxcli.yaml")
	}
	configFile, err = filepath.Abs(configFile)
	if err != nil {
		return nil, err
	}
	data, err := readBounded(configFile, 1<<20)
	if err != nil && (!os.IsNotExist(err) || config != "") {
		return nil, errors.New("The CLI configuration could not be read within its 1 MiB limit")
	}
	c.connection = hash(append(jsonValue([]any{executable, configFile, auth, cx}), data...))
	return c, nil
}
func (c *CLI) redact(s string) string {
	s = ansiPattern.ReplaceAllString(s, "")
	for _, secret := range c.secrets {
		s = strings.ReplaceAll(s, secret, "[redacted]")
	}
	s = jwtPattern.ReplaceAllString(s, "[redacted]")
	s = urlCredentialPattern.ReplaceAllString(s, "$1[redacted]@")
	s = signedURLPattern.ReplaceAllString(s, "$1[redacted]")
	return credentialPattern.ReplaceAllString(s, "$1[redacted]")
}

var ansiPattern = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)
var jwtPattern = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b`)
var urlCredentialPattern = regexp.MustCompile(`(?i)(https?://)[^\s/@]+:[^\s/@]+@`)
var signedURLPattern = regexp.MustCompile(`(?i)([?&](?:X-Amz-[\w-]+|X-Goog-[\w-]+|token|signature|sig|se|sp|sv)=)[^\s&"<>]+`)

var credentialPattern = regexp.MustCompile(`(?i)((?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|authorization|bearer)[\s"':=]+)[^\s",}]+`)

type boundedOutput struct {
	mu           sync.Mutex
	data         bytes.Buffer
	limit        int
	cancel       context.CancelFunc
	line         func(string)
	partial      string
	suppressLine bool
	redact       func(string) string
	exceeded     bool
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.data.Len()+len(p) > b.limit {
		b.exceeded = true
		b.cancel()
		return 0, errors.New("CLI output exceeded its size limit")
	}
	b.data.Write(p)
	if b.line != nil {
		remaining := string(p)
		for {
			fragment, rest, complete := strings.Cut(remaining, "\n")
			if b.suppressLine {
				if complete {
					b.suppressLine = false
				}
			} else if len(b.partial)+len(fragment) > 16384 {
				b.partial = ""
				b.suppressLine = !complete
				b.line("[Oversized CLI log line omitted]")
			} else {
				b.partial += fragment
				if complete {
					b.line(b.redact(strings.TrimSuffix(b.partial, "\r")))
					b.partial = ""
				}
			}
			if !complete {
				break
			}
			remaining = rest
		}
	}
	return len(p), nil
}
func (c *CLI) command(ctx context.Context, args []string, timeout time.Duration, onLine func(string), raw bool) (string, error) {
	lane := c.capacity
	if len(args) > 1 && args[0] == "scan" && args[1] == "cancel" {
		lane = c.control
	}
	queued := false
	if lane == c.capacity {
		select {
		case c.queue <- struct{}{}:
			queued = true
		default:
			return "", errors.New("CLI command queue is full; retry shortly")
		}
	}
	releaseQueue := func() {
		if queued {
			<-c.queue
			queued = false
		}
	}
	defer releaseQueue()
	select {
	case lane <- struct{}{}:
	case <-ctx.Done():
		return "", ctx.Err()
	case <-time.After(30 * time.Second):
		return "", errors.New("CLI capacity is full; retry shortly")
	}
	defer func() { <-lane }()
	releaseQueue()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	args = append([]string{}, args...)
	if !raw {
		args = append(args, "--debug=false")
		if c.config != "" {
			args = append(args, "--config-file-path="+c.config)
		}
	}
	cmd := exec.CommandContext(ctx, c.executable, args...)
	cmd.Env = c.env
	cmd.Dir, _ = os.UserHomeDir()
	prepareProcess(cmd)
	output := &boundedOutput{limit: 64 << 20, cancel: cancel, line: onLine, redact: c.redact}
	if raw {
		output.limit = 512 << 10
	}
	errout := &boundedOutput{limit: 1 << 20, cancel: cancel, line: onLine, redact: c.redact}
	cmd.Stdout = output
	cmd.Stderr = errout
	cmd.WaitDelay = 2 * time.Second
	var release func() error
	if c.guard != nil {
		var closeGate func()
		var err error
		release, closeGate, err = prepareGuardedProcess(cmd)
		if err != nil {
			return "", errors.New("The CLI launch could not be isolated")
		}
		defer closeGate()
	}
	if err := cmd.Start(); err != nil {
		return "", errors.New("The Checkmarx CLI could not start")
	}
	var guard io.Closer
	if c.guard != nil {
		var err error
		guard, err = c.guard(cmd)
		if err != nil {
			cmd.Process.Kill()
			cmd.Wait()
			return "", errors.New("The CLI process could not be isolated")
		}
		defer guard.Close()
		if err := release(); err != nil {
			cmd.Process.Kill()
			cmd.Wait()
			return "", errors.New("The protected CLI could not start")
		}
	}
	err := cmd.Wait()
	if output.line != nil && output.partial != "" {
		onLine(c.redact(output.partial))
	}
	if errout.line != nil && errout.partial != "" {
		onLine(c.redact(errout.partial))
	}
	if output.exceeded || errout.exceeded {
		return "", errors.New("CLI output exceeded its size limit")
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if err != nil {
		message := c.redact(strings.TrimSpace(errout.data.String()))
		if len(message) > 2000 {
			message = message[:2000]
		}
		if message == "" {
			message = "Checkmarx CLI command failed"
		}
		return "", errors.New(message)
	}
	return output.data.String(), nil
}
func parseJSON(s string) (any, error) {
	s = strings.TrimSpace(strings.TrimPrefix(s, "\ufeff"))
	var v any
	if json.Unmarshal([]byte(s), &v) == nil {
		return v, nil
	}
	// Find complete containers in one pass. Respect string escapes so braces
	// in messages cannot truncate a response, and retain the last response.
	start := -1
	stack := []byte{}
	quoted, escaped, found := false, false, false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if start < 0 {
			if ch != '{' && ch != '[' {
				continue
			}
			start = i
		}
		if quoted {
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == '"' {
				quoted = false
			}
			continue
		}
		switch ch {
		case '"':
			quoted = true
		case '{', '[':
			stack = append(stack, ch)
		case '}', ']':
			if len(stack) == 0 || (ch == '}' && stack[len(stack)-1] != '{') || (ch == ']' && stack[len(stack)-1] != '[') {
				start, stack = -1, stack[:0]
				continue
			}
			stack = stack[:len(stack)-1]
			if len(stack) == 0 {
				var candidate any
				if json.Unmarshal([]byte(s[start:i+1]), &candidate) == nil {
					v, found = candidate, true
				}
				start = -1
			}
		}
	}
	if found {
		return v, nil
	}
	return nil, errors.New("The CLI returned unrecognized JSON")
}
func (c *CLI) json(ctx context.Context, args ...string) (any, error) {
	s, err := c.command(ctx, args, 2*time.Minute, nil, false)
	if err != nil {
		return nil, err
	}
	return parseJSON(s)
}

type capability struct{ args, flags []string }

var requiredCapabilities = []capability{
	{[]string{}, []string{"debug", "retry", "config-file-path"}},
	{[]string{"auth", "validate"}, nil},
	{[]string{"project", "list"}, []string{"format", "filter"}},
	{[]string{"project", "show"}, []string{"project-id", "format"}},
	{[]string{"scan", "create"}, []string{"file-source", "project-name", "branch", "scan-types", "async", "scan-info-format", "skip-default-filter", "file-filter", "exclude-git-folder", "sast-incremental", "sast-preset-name", "sca-exploitable-path"}},
	{[]string{"scan", "show"}, []string{"scan-id", "format"}},
	{[]string{"scan", "list"}, []string{"format", "filter"}},
	{[]string{"scan", "cancel"}, []string{"scan-id"}},
	{[]string{"results", "show"}, []string{"scan-id", "report-format", "output-name", "output-path"}},
}
var helpFlag = regexp.MustCompile(`(?m)^\s*(?:-[\w?],\s*)?--([a-z][a-z0-9-]*)(?:\s|=|$)`)

func (c *CLI) preflight(ctx context.Context) (string, map[string]bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	version, err := c.command(ctx, []string{"version"}, 10*time.Second, nil, true)
	if err != nil {
		return "", nil, errors.New("Could not identify the selected CLI; no upload was started")
	}
	version = strings.TrimSpace(version)
	if len(version) > 120 {
		version = version[:120]
	}
	scanFlags := map[string]bool{}
	for _, command := range requiredCapabilities {
		args := append(append([]string{}, command.args...), "--help")
		help, err := c.command(ctx, args, 10*time.Second, nil, true)
		if err != nil {
			return "", nil, fmt.Errorf("CLI cannot describe %s; no upload was started", strings.Join(command.args, " "))
		}
		flags := map[string]bool{}
		for _, m := range helpFlag.FindAllStringSubmatch(help, -1) {
			flags[m[1]] = true
		}
		for _, f := range command.flags {
			if !flags[f] {
				return "", nil, fmt.Errorf("CLI is missing %s --%s; no upload was started", strings.Join(command.args, " "), f)
			}
		}
		if len(command.args) == 0 || strings.Join(command.args, " ") == "scan create" {
			for f := range flags {
				scanFlags[f] = true
			}
		}
	}
	return version, scanFlags, nil
}
func scanFromCLI(v any) (Object, error) {
	m := object(v)
	r := Object{}
	for _, pair := range [][2]string{{"id", "ID"}, {"status", "Status"}, {"projectId", "ProjectID"}, {"projectName", "ProjectName"}, {"branch", "Branch"}, {"createdAt", "CreatedAt"}, {"updatedAt", "UpdatedAt"}, {"sourceOrigin", "Origin"}, {"tags", "Tags"}} {
		value := m[pair[1]]
		if value == nil {
			value = m[pair[0]]
		}
		r[pair[0]] = value
	}
	for _, k := range []string{"id", "status", "projectId"} {
		if str(r, k) == "" {
			return nil, fmt.Errorf("CLI response has no %s", k)
		}
	}
	r["status"] = status(r["status"])
	return r, nil
}
func (c *CLI) scan(ctx context.Context, id string) (Object, error) {
	v, err := c.json(ctx, "scan", "show", "--scan-id="+id, "--format=json")
	if err != nil {
		return nil, err
	}
	m, err := scanFromCLI(v)
	if err == nil && str(m, "id") != id {
		err = errors.New("CLI returned a different scan")
	}
	return m, err
}
func projectFromCLI(v any) (Object, error) {
	m := object(v)
	r := Object{}
	for _, p := range [][2]string{{"id", "ID"}, {"name", "Name"}, {"mainBranch", "MainBranch"}, {"tags", "Tags"}} {
		r[p[0]] = m[p[1]]
		if r[p[0]] == nil {
			r[p[0]] = m[p[0]]
		}
	}
	if str(r, "id") == "" || str(r, "name") == "" {
		return nil, errors.New("CLI project has no identity or name")
	}
	if str(r, "mainBranch") == "" {
		r["mainBranch"] = "main"
	}
	if r["tags"] == nil {
		r["tags"] = Object{}
	}
	return r, nil
}
func (c *CLI) project(ctx context.Context, id string) (Object, error) {
	v, err := c.json(ctx, "project", "show", "--project-id="+id, "--format=json")
	if err != nil {
		return nil, err
	}
	p, err := projectFromCLI(v)
	if err == nil && str(p, "id") != id {
		err = errors.New("CLI returned a different project")
	}
	return p, err
}
func (c *CLI) projects(ctx context.Context, limit int) ([]Object, error) {
	out := []Object{}
	seen := map[string]bool{}
	for offset := 0; offset < limit; {
		size := min(100, limit-offset)
		v, err := c.json(ctx, "project", "list", "--format=json", fmt.Sprintf("--filter=limit=%d,offset=%d,sort=name", size, offset))
		if err != nil {
			return nil, err
		}
		items, ok := v.([]any)
		if !ok || len(items) > size {
			return nil, errors.New("CLI returned an invalid project list")
		}
		for _, item := range items {
			p, err := projectFromCLI(item)
			if err != nil {
				return nil, err
			}
			if seen[str(p, "id")] {
				return nil, errors.New("CLI returned duplicate projects")
			}
			seen[str(p, "id")] = true
			out = append(out, p)
		}
		if len(items) < size {
			return out, nil
		}
		offset += size
	}
	return out, nil
}
func csvValue(v string) string {
	if !strings.ContainsAny(v, ",\"\r\n") {
		return v
	}
	var b strings.Builder
	w := csv.NewWriter(&b)
	_ = w.Write([]string{v})
	w.Flush()
	return strings.TrimSuffix(b.String(), "\n")
}
func buildScanArgs(job Object) ([]string, error) {
	o := object(job["options"])
	scanners := stringsOf(o["scanners"])
	if strings.TrimSpace(str(job, "projectName")) == "" || strings.TrimSpace(str(job, "branch")) == "" || len(scanners) == 0 {
		return nil, errors.New("Select a project, branch and supported scanners")
	}
	for _, s := range scanners {
		if s != "sast" && s != "sca" {
			return nil, errors.New("Unsupported scanner")
		}
	}
	excludes := append([]string{}, defaultExcludes...)
	for _, entry := range stringsOf(o["excludes"]) {
		entry = strings.TrimSpace(entry)
		if strings.HasPrefix(entry, "!") {
			name := entry[1:]
			filtered := []string{}
			for _, e := range excludes {
				if e != name {
					filtered = append(filtered, e)
				}
			}
			excludes = filtered
		} else if entry != "" && !contains(excludes, entry) {
			excludes = append(excludes, entry)
		}
	}
	files, paths := []string{}, []string{}
	for _, e := range excludes {
		if strings.ContainsAny(e, ",\r\n") {
			return nil, errors.New("Excludes cannot contain commas or newlines")
		}
		if strings.Contains(e, "/") {
			paths = append(paths, "!"+e, "!"+strings.TrimSuffix(e, "/")+"/**")
		} else {
			files = append(files, "!"+e)
		}
	}
	args := []string{"scan", "create", "--file-source=" + str(job, "folderPath"), "--project-name=" + str(job, "projectName"), "--branch=" + str(job, "branch"), "--scan-types=" + strings.Join(scanners, ","), "--async", "--scan-info-format=json", "--skip-default-filter", "--file-filter=" + strings.Join(files, ","), "--retry=0"}
	if len(paths) > 0 {
		args = append(args, "--file-filter-ext="+strings.Join(paths, ","))
	}
	if contains(excludes, ".git") {
		args = append(args, "--exclude-git-folder")
	}
	if contains(scanners, "sast") {
		args = append(args, fmt.Sprintf("--sast-incremental=%t", boolean(o["sastIncremental"])))
		if v := str(o, "sastPreset"); v != "" {
			args = append(args, "--sast-preset-name="+v)
		}
		if boolean(o["sastIncremental"]) && str(o, "sastBaseBranch") != "" {
			args = append(args, "--base-branch="+str(o, "sastBaseBranch"))
		}
	}
	if contains(scanners, "sca") {
		args = append(args, fmt.Sprintf("--sca-exploitable-path=%t", boolean(o["scaExploitablePath"])))
	}
	tags := []string{}
	for k, v := range object(o["tags"]) {
		s, ok := v.(string)
		if !ok || strings.ContainsAny(k+s, ":,\r\n") {
			return nil, errors.New("Tags must be text without colons, commas or newlines")
		}
		tags = append(tags, k+":"+s)
	}
	sort.Strings(tags)
	if len(tags) > 0 {
		args = append(args, "--tags="+strings.Join(tags, ","))
	}
	return args, nil
}
func (c *CLI) report(ctx context.Context, id, format string) ([]byte, error) {
	dir, err := os.MkdirTemp("", "marx-cli-report-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	_, err = c.command(ctx, []string{"results", "show", "--scan-id=" + id, "--report-format=" + format, "--output-name=report", "--output-path=" + dir}, 10*time.Minute, nil, false)
	if err != nil {
		return nil, err
	}
	extension := "json"
	if format == "sarif" {
		extension = "sarif"
	}
	data, err := readBounded(filepath.Join(dir, "report."+extension), 64<<20)
	if err != nil {
		return nil, errors.New("CLI report is unreadable or exceeds 64 MiB")
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	var v Object
	if json.Unmarshal(data, &v) != nil {
		return nil, errors.New("CLI report is not valid JSON")
	}
	if format == "sarif" {
		if str(v, "version") != "2.1.0" {
			return nil, errors.New("Unrecognized SARIF version")
		}
		if _, ok := v["runs"].([]any); !ok {
			return nil, errors.New("SARIF has no runs array")
		}
	}
	return data, nil
}
func readBounded(file string, limit int64) ([]byte, error) {
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return readBoundedFile(f, limit)
}
func readBoundedFile(f *os.File, limit int64) ([]byte, error) {
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > limit {
		return nil, errors.New("File exceeds size limit or is not regular")
	}
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if int64(len(data)) > limit {
		return nil, errors.New("File exceeds size limit")
	}
	return data, err
}
