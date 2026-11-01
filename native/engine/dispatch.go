package engine

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

func (e *Engine) Invoke(channel string, raw []json.RawMessage) (any, error) {
	if len(raw) > 8 {
		return nil, errors.New("Too many operation arguments")
	}
	total := 0
	for _, value := range raw {
		if len(value) > 64<<20-total {
			return nil, errors.New("Operation exceeds its combined size limit")
		}
		total += len(value)
	}
	e.mu.Lock()
	if e.closed {
		e.mu.Unlock()
		return nil, errors.New("Marx is shutting down")
	}
	if e.pending >= 256 || e.pendingBytes > 128<<20-total {
		e.mu.Unlock()
		return nil, errors.New("Too many pending desktop operations")
	}
	e.pending++
	e.pendingBytes += total
	e.wg.Add(1)
	e.mu.Unlock()
	defer func() { e.mu.Lock(); e.pending--; e.pendingBytes -= total; e.mu.Unlock(); e.wg.Done() }()
	args := make([]any, len(raw))
	for i, b := range raw {
		if len(b) > 64<<20 {
			return nil, errors.New("Operation exceeds size limit")
		}
		if json.Unmarshal(b, &args[i]) != nil {
			return nil, errors.New("Invalid operation arguments")
		}
	}
	e.mu.Lock()
	closed := e.closed
	e.mu.Unlock()
	if closed {
		return nil, errors.New("Marx is shutting down")
	}
	return e.dispatch(e.ctx, channel, args)
}
func arg(args []any, i int) any {
	if i < len(args) {
		return args[i]
	}
	return nil
}
func (e *Engine) dispatch(ctx context.Context, ch string, args []any) (any, error) {
	a := arg(args, 0)
	m := object(a)
	s := text(a)
	switch ch {
	case "intel:decisions":
		return e.decisions()
	case "intel:decide":
		return e.recordDecision(m)
	case "intel:close-decision":
		return e.closeDecision(m)
	case "intel:decision-history":
		return e.decisionHistory(s)
	case "intel:export-decisions":
		return e.exportDecisions()
	case "intel:clear-cache":
		return nil, e.intel.clearCache()
	case "intel:settings":
		return e.intel.settings()
	case "intel:configure":
		return e.intel.configure(m)
	case "intel:get":
		return e.intel.get(a)
	case "intel:refresh":
		return e.intel.refresh(m)
	case "intel:cancel":
		e.intel.cancel(s)
		return nil, nil
	case "intel:watch", "intel:unwatch":
		return e.intel.watch(m, ch == "intel:unwatch")
	case "intel:watchlist":
		return e.intel.watchlist()

	case "settings:get":
		return e.getSettings(), nil
	case "settings:save":
		next := clone(m)
		delete(next, "recentFolders")
		return e.saveSettings(next)
	case "settings:set-api-key":
		key, err := bounded(a, "API key", 1<<20)
		if err != nil {
			return nil, err
		}
		return e.setKey(key)
	case "settings:test-connection":
		c, err := e.client()
		if err != nil {
			return nil, err
		}
		version, _, err := c.preflight(ctx)
		if err != nil {
			return nil, err
		}
		if _, err = c.command(ctx, []string{"auth", "validate"}, time.Minute, nil, false); err != nil {
			return nil, err
		}
		if _, err = c.projects(ctx, 1); err != nil {
			return nil, err
		}
		return Object{"ok": true, "message": "CLI capabilities, authentication and project access verified.", "cliPath": c.executable, "cliVersion": version}, nil
	case "dialog:select-folder", "dialog:select-cli":
		p := Object{"title": "Select the official Checkmarx CLI executable", "properties": []string{"openFile"}}
		if ch == "dialog:select-folder" {
			p = Object{"title": "Select source folder", "properties": []string{"openDirectory"}}
		}
		v, err := e.native("open", p)
		if err != nil {
			return nil, err
		}
		result := object(v)
		paths := stringsOf(result["filePaths"])
		if boolean(result["canceled"]) || len(paths) == 0 {
			return nil, nil
		}
		if ch == "dialog:select-folder" {
			return e.grant(paths[0])
		}
		return paths[0], nil
	case "fs:read-source-file", "fs:open-in-editor":
		folder, err := e.requireFolder(s)
		if err != nil {
			return nil, err
		}
		connection, err := e.connection(true)
		if err != nil {
			return nil, err
		}
		b, err := e.store.get("binding", connection, pathIdentity(folder))
		if err != nil {
			return nil, err
		}
		project := text(arg(args, 3))
		if project == "" || str(b, "projectId") != project {
			return nil, errors.New("Link this repository to the selected project before reading source")
		}
		snippet, err := readSnippet(folder, text(arg(args, 1)), integer(arg(args, 2), 1, 1, 1<<30))
		if err != nil {
			return nil, err
		}
		if ch == "fs:read-source-file" {
			return snippet, nil
		}
		editor := text(arg(args, 4))
		scheme := "vscode"
		if editor == "cursor" {
			scheme = "cursor"
		} else if editor != "code" {
			return nil, errors.New("Choose a supported editor")
		}
		target := &url.URL{Scheme: scheme, Host: "file", Path: "/" + filepath.ToSlash(filepath.Join(folder, str(snippet, "path"))) + fmt.Sprintf(":%d", integer(arg(args, 2), 1, 1, int(number(snippet["totalLines"]))))}
		return e.native("external", Object{"url": target.String()})
	case "fs:source-status":
		folder, err := e.requireFolder(s)
		if err != nil {
			return nil, err
		}
		page, err := e.results(ctx, text(arg(args, 1)), Object{})
		if err != nil {
			return nil, err
		}
		p := provenance(page)
		source := object(p["source"])
		if str(source, "folderPath") != folder || str(source, "fingerprint") == "" {
			return Object{"matches": nil, "message": "No matching source fingerprint; displayed code is the current checkout."}, nil
		}
		current := object(captureProvenance(ctx, folder, object(p["options"]), str(p, "connectionId"), str(p, "cliVersion"))["source"])
		if str(current, "fingerprint") == "" {
			return Object{"matches": nil, "message": current["captureWarning"]}, nil
		}
		matches := str(current, "fingerprint") == str(source, "fingerprint")
		message := "Local source changed after the recorded scan; locations may have moved."
		if matches {
			message = "The recorded source fingerprint matches; the uploaded archive was not preserved."
		}
		return Object{"matches": matches, "message": message}, nil
	case "git:info":
		folder, err := e.requireFolder(s)
		if err != nil {
			return nil, err
		}
		return gitInfo(ctx, folder), nil
	case "git:workspace-plan", "fs:list-subfolders":
		folder, err := e.requireFolder(s)
		if err != nil {
			return nil, err
		}
		plan, err := planWorkspace(ctx, folder)
		if err != nil {
			return nil, err
		}
		folders := []string{}
		for _, p := range objects(plan["projects"]) {
			if canonical, err := e.grant(str(p, "folderPath")); err == nil {
				folders = append(folders, canonical)
			}
		}
		if ch == "fs:list-subfolders" {
			return folders, nil
		}
		return plan, nil
	case "shell:open-external":
		u, err := url.Parse(s)
		if err != nil || u.Scheme != "https" || u.Host == "" {
			return nil, errors.New("Only HTTPS links can be opened")
		}
		return e.native("external", Object{"url": s})
	case "bindings:get", "bindings:save":
		folder, err := e.requireFolder(s)
		if err != nil {
			return nil, err
		}
		c, err := e.client()
		if err != nil {
			return nil, err
		}
		if ch == "bindings:get" {
			return e.store.get("binding", c.connection, pathIdentity(folder))
		}
		id, err := identifier(arg(args, 1))
		if err != nil {
			return nil, err
		}
		project, err := c.project(ctx, id)
		if err != nil {
			return nil, err
		}
		if err = e.checkConnection(c); err != nil {
			return nil, err
		}
		binding := Object{"folderPath": folder, "projectId": id, "projectName": project["name"], "connectionId": c.connection}
		err = e.store.save(record{kind: "binding", scope: c.connection, id: pathIdentity(folder), value: binding})
		return binding, err
	case "projects:list":
		c, err := e.client()
		if err != nil {
			return nil, err
		}
		return c.projects(ctx, 1000)
	case "scan:run":
		job, c, err := e.prepareJob(ctx, m)
		if err != nil {
			return nil, err
		}
		return e.startJob(job, c, false)
	case "scan:run-batch":
		return e.runBatch(ctx, m)
	case "scan:cancel-job":
		e.mu.Lock()
		e.canceled[str(m, "id")] = true
		if active := e.active[str(m, "id")]; active != nil {
			active.cancel()
		}
		e.mu.Unlock()
		return nil, nil
	case "scan:jobs":
		connection, err := e.connection(true)
		if err != nil {
			return nil, err
		}
		return e.store.list("job", &connection)
	case "scan:history":
		c, err := e.client()
		if err != nil {
			return nil, err
		}
		filter := fmt.Sprintf("limit=%d,offset=%d,sort=-created_at", integer(m["limit"], 50, 1, 200), integer(m["offset"], 0, 0, 1<<30))
		if str(m, "projectId") != "" {
			filter += "," + csvValue("project-id="+str(m, "projectId"))
		}
		v, err := c.json(ctx, "scan", "list", "--format=json", "--filter="+filter)
		if err != nil {
			return nil, err
		}
		items, ok := v.([]any)
		if !ok {
			return nil, errors.New("CLI returned an invalid scan list")
		}
		out := []Object{}
		jobs, err := e.store.list("job", &c.connection)
		if err != nil {
			return nil, err
		}
		for _, v := range items {
			scan, err := scanFromCLI(v)
			if err != nil {
				return nil, err
			}
			scan["connectionId"] = c.connection
			for _, j := range jobs {
				if str(j, "scanId") == str(scan, "id") {
					scan["provenance"] = j["provenance"]
				}
			}
			out = append(out, scan)
		}
		return out, e.checkConnection(c)
	case "scan:summary":
		c, err := e.client()
		if err != nil {
			return nil, err
		}
		return e.summary(ctx, c, s)
	case "results:get":
		return e.results(ctx, s, object(arg(args, 1)))
	case "results:cancel":
		e.cancelImport(s)
		return nil, nil
	case "results:compare":
		before, err := e.results(ctx, s, Object{})
		if err != nil {
			return nil, err
		}
		after, err := e.results(ctx, text(arg(args, 1)), Object{})
		if err != nil {
			return nil, err
		}
		return compareScans(before, after), nil
	case "results:query":
		if _, err := e.results(ctx, s, Object{}); err != nil {
			return nil, err
		}
		connection, err := e.connection(true)
		if err != nil {
			return nil, err
		}
		return e.store.query(connection, s, object(arg(args, 1)))
	case "results:triage":
		return e.triage(ctx, m)
	case "results:export":
		return e.exportResults(m)
	case "results:sarif":
		c, err := e.client()
		if err != nil {
			return nil, err
		}
		if _, err = identifier(s); err != nil {
			return nil, err
		}
		data, err := c.report(ctx, s, "sarif")
		if err != nil {
			return nil, err
		}
		return e.saveEvidence("Export Checkmarx SARIF", "marx-"+safeFilename(s)+".sarif", data)
	case "remediation:copy":
		if err := requirePrompt(s); err != nil {
			return nil, err
		}
		return e.native("clipboard", Object{"text": s})
	case "remediation:save":
		if err := requirePrompt(str(m, "text")); err != nil {
			return nil, err
		}
		name, err := bounded(m["suggestedName"], "Filename", 1024)
		if err != nil {
			return nil, err
		}
		return e.saveEvidence("Save remediation prompt", safeFilename(name)+".md", []byte(str(m, "text")))
	case "workbench:bootstrap":
		return e.bootstrap()
	case "session:evidence":
		return e.bundle(s)
	case "workspace:get", "workspace:save":
		key, err := bounded(a, "Workspace key", 512)
		if err != nil {
			return nil, err
		}
		connection, err := e.connection(true)
		if err != nil {
			connection = "local"
		}
		key = connection + ":" + key
		if ch == "workspace:get" {
			return e.store.get("workspace", "", key)
		}
		state := object(arg(args, 1))
		if arg(args, 1) == nil || len(jsonValue(state)) > 32768 {
			return nil, errors.New("Workspace state is invalid or too large")
		}
		return nil, e.store.save(record{kind: "workspace", id: key, value: state})
	case "session:create":
		return e.createSession(ctx, m)
	case "session:update":
		return e.updateSession(m)
	case "session:verify":
		return e.verifySession(ctx, str(m, "id"), str(m, "scanId"))
	case "session:run-verification":
		return e.runVerification(ctx, s)
	case "session:export":
		bundle, err := e.bundle(s)
		if err != nil {
			return nil, err
		}
		data, _ := json.MarshalIndent(bundle, "", "  ")
		return e.saveEvidence("Export remediation evidence", "marx-"+safeFilename(str(object(bundle["session"]), "title"))+".json", data)
	case "session:delete":
		return nil, e.deleteSession(s)
	case "job:reconcile":
		connection, err := e.connection(false)
		if err != nil {
			return nil, err
		}
		job, err := e.store.get("job", connection, s)
		if err != nil {
			return nil, err
		}
		if job == nil {
			return nil, errors.New("Job unavailable in this connection")
		}
		c, err := e.client()
		if err != nil {
			return nil, err
		}
		return e.startJob(job, c, true)
	case "job:logs":
		connection, err := e.connection(true)
		if err != nil {
			return nil, err
		}
		job, err := e.store.get("job", connection, s)
		if err != nil {
			return nil, err
		}
		if job == nil {
			return nil, errors.New("Job unavailable in this connection")
		}
		return e.store.logs(s)
	case "snapshot:delete":
		connection, err := e.connection(true)
		if err != nil {
			return nil, err
		}
		return nil, e.deleteSnapshot(connection, s)
	case "workbench:prune":
		days := int(number(a))
		if number(a) != float64(days) || days < 1 || days > 3650 {
			return nil, errors.New("Choose retention between 1 and 3,650 days")
		}
		return nil, e.prune(days)
	default:
		return nil, errors.New("Unknown desktop operation")
	}
}
func requirePrompt(s string) error {
	if strings.TrimSpace(s) == "" || len(s) > 8<<20 {
		return errors.New("Prompt must contain text and fit within 8 MiB")
	}
	return nil
}

var unsafeFilename = regexp.MustCompile(`[^\pL\pN._-]+`)

func safeFilename(s string) string {
	s = strings.Trim(unsafeFilename.ReplaceAllString(s, "-"), ".- ")
	if len(s) > 100 {
		s = string([]rune(s)[:min(80, len([]rune(s)))])
	}
	if s == "" {
		s = "export"
	}
	switch strings.ToUpper(strings.Split(s, ".")[0]) {
	case "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		s = "marx-" + s
	}
	return s
}
func (e *Engine) saveEvidence(title, name string, data []byte) (any, error) {
	v, err := e.native("save", Object{"title": title, "defaultPath": filepath.Join(e.host.Downloads, name)})
	if err != nil {
		return nil, err
	}
	m := object(v)
	if boolean(m["canceled"]) || str(m, "filePath") == "" {
		return nil, nil
	}
	target := str(m, "filePath")
	if !filepath.IsAbs(target) {
		return nil, errors.New("Choose an absolute save path")
	}
	if err = writePrivate(target, data); err != nil {
		return nil, err
	}
	return target, nil
}
func (e *Engine) exportResults(m Object) (any, error) {
	format := str(m, "format")
	findings := objects(m["findings"])
	if len(findings) != len(array(m["findings"])) || len(findings) > 100000 {
		return nil, errors.New("Invalid findings export")
	}
	var data []byte
	switch format {
	case "json":
		counts := Object{"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "INFO": 0, "UNKNOWN": 0}
		for _, f := range findings {
			k := str(f, "severity")
			counts[k] = number(counts[k]) + 1
		}
		cves := []string{}
		for _, finding := range findings {
			if cve, err := normalizeCVE(str(finding, "cve")); err == nil {
				cves = append(cves, cve)
			}
		}
		intelligence, err := e.cachedIntelligence(cves)
		if err != nil {
			return nil, err
		}
		data, _ = json.MarshalIndent(Object{"exportedAt": time.Now().UTC().Format(time.RFC3339Nano), "totalCount": len(findings), "severityCounts": counts, "findings": findings, "intelligence": intelligence}, "", "  ")
	case "csv":
		var b strings.Builder
		w := csv.NewWriter(&b)
		keys := []string{"severity", "state", "status", "type", "title", "where", "group", "language", "cve_cwe", "cvssScore", "packageName", "packageVersion", "recommendedVersion", "similarityId", "description"}
		w.UseCRLF = true
		_ = w.Write(keys)
		for _, f := range findings {
			row := []string{}
			for _, k := range keys {
				s := stringValue(f[k])
				if k == "cve_cwe" {
					s = str(f, "cve")
					if s == "" && str(f, "cwe") != "" {
						s = "CWE-" + strings.TrimPrefix(strings.TrimPrefix(str(f, "cwe"), "CWE-"), "CWE")
					}
				}
				trimmed := strings.TrimSpace(s)
				if len(trimmed) > 0 && strings.ContainsRune("=+-@", rune(trimmed[0])) {
					s = "'" + s
				}
				row = append(row, s)
			}
			if err := w.Write(row); err != nil {
				return nil, err
			}
		}
		w.Flush()
		if w.Error() != nil {
			return nil, w.Error()
		}
		data = []byte("\ufeff" + b.String())
	default:
		return nil, errors.New("Choose CSV or JSON export")
	}
	name := "marx-" + safeFilename(str(m, "label")) + "-" + time.Now().UTC().Format("2006-01-02-150405") + "-" + uuid()[:8] + "." + format
	target := filepath.Join(e.host.Downloads, name)
	f, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, errors.New("Export could not be created in Downloads")
	}
	_, err = f.Write(data)
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(target)
		return nil, errors.New("Findings export could not be written")
	}
	_, _ = e.native("reveal", Object{"file": target})
	return target, nil
}
func (e *Engine) triage(ctx context.Context, m Object) (any, error) {
	c, err := e.client()
	if err != nil {
		return nil, err
	}
	f := object(m["finding"])
	if str(f, "connectionId") != c.connection {
		return nil, errors.New("Reload this finding in the current connection before triage")
	}
	state := str(m, "state")
	if !contains([]string{"TO_VERIFY", "NOT_EXPLOITABLE", "PROPOSED_NOT_EXPLOITABLE", "CONFIRMED", "URGENT"}, state) || str(f, "projectId") == "" || strings.TrimSpace(str(m, "comment")) == "" {
		return nil, errors.New("A project, supported state, and comment are required")
	}
	args := []string{"triage", "update", "--project-id=" + str(f, "projectId"), "--state=" + state, "--comment=" + str(m, "comment"), "--retry=0"}
	scanner := str(f, "type")
	if scanner == "sca" {
		parts := []string{}
		for _, p := range [][2]string{{"packageName", "packageName"}, {"packageVersion", "packageVersion"}, {"packageManager", "packageManager"}, {"vulnerabilityId", "cve"}} {
			if str(f, p[1]) == "" {
				return nil, errors.New("SCA triage requires complete package identity")
			}
			parts = append(parts, csvValue(p[0]+"="+str(f, p[1])))
		}
		args = append(args, "--scan-type=sca", "--vulnerability-identifiers="+strings.Join(parts, ","))
	} else {
		if !contains([]string{"sast", "kics", "iac-security"}, scanner) || str(f, "similarityId") == "" {
			return nil, errors.New("This finding requires triage in Checkmarx One")
		}
		severity := str(m, "severity")
		if severity == "" {
			severity = str(f, "severity")
		}
		if !contains([]string{"CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"}, severity) {
			return nil, errors.New("Choose a supported severity")
		}
		if scanner == "kics" {
			scanner = "iac-security"
		}
		args = append(args, "--scan-type="+scanner, "--similarity-id="+str(f, "similarityId"), "--severity="+severity)
	}
	_, err = c.command(ctx, args, time.Minute, nil, false)
	return err == nil, err
}
