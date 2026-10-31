package engine

import (
	"context"
	"errors"
	"strings"
	"time"
)

func (e *Engine) results(ctx context.Context, id string, options Object) (Object, error) {
	if _, err := identifier(id); err != nil {
		return nil, err
	}
	connection, err := e.connection(true)
	if err != nil {
		return nil, err
	}
	cached, err := e.store.get("snapshot", connection, id)
	if err != nil {
		return nil, err
	}
	if cached != nil && !boolean(options["refresh"]) {
		cached["cached"] = true
		return cached, nil
	}
	c, err := e.client()
	if err != nil {
		return nil, err
	}
	if c.connection != connection {
		return nil, errors.New("Connection changed; reload the workspace")
	}
	request := str(options, "requestId")
	if request == "" {
		request = uuid()
	}
	if _, err = identifier(request); err != nil {
		return nil, err
	}
	key := connection + ":" + id
	e.mu.Lock()
	if e.closed {
		e.mu.Unlock()
		return nil, errors.New("Marx is shutting down")
	}
	if old := e.requests[request]; old != nil && old != e.imports[key] {
		delete(old.readers, request)
		if len(old.readers) == 0 {
			old.canceled = true
			old.cancel()
		}
	}
	task := e.imports[key]
	if task == nil || task.canceled {
		taskCtx, cancel := context.WithCancel(e.ctx)
		task = &importTask{done: make(chan struct{}), cancel: cancel, readers: map[string]bool{}}
		e.imports[key] = task
		e.wg.Add(1)
		go func(t *importTask) {
			defer e.wg.Done()
			defer cancel()
			page, err := e.importResults(taskCtx, c, id)
			e.mu.Lock()
			t.page, t.err = page, err
			if e.imports[key] == t {
				delete(e.imports, key)
			}
			close(t.done)
			e.mu.Unlock()
		}(task)
	}
	task.readers[request] = true
	e.requests[request] = task
	e.mu.Unlock()
	defer func() {
		e.mu.Lock()
		delete(task.readers, request)
		if e.requests[request] == task {
			delete(e.requests, request)
		}
		if len(task.readers) == 0 {
			task.canceled = true
			task.cancel()
		}
		e.mu.Unlock()
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-task.done:
		return clone(task.page), task.err
	}
}
func (e *Engine) cancelImport(request string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if task := e.requests[request]; task != nil {
		delete(task.readers, request)
		delete(e.requests, request)
		if len(task.readers) == 0 {
			task.canceled = true
			task.cancel()
		}
	}
}
func (e *Engine) importResults(ctx context.Context, c *CLI, id string) (Object, error) {
	scan, err := c.scan(ctx, id)
	if err != nil {
		return nil, err
	}
	data, err := c.report(ctx, id, "json")
	if err != nil {
		return nil, err
	}
	v, err := parseJSON(string(data))
	if err != nil {
		return nil, err
	}
	raw := object(v)
	resultValue, hasResults := raw["results"]
	items, ok := resultValue.([]any)
	if hasResults && resultValue == nil && raw["totalCount"] == float64(0) {
		items = []any{}
		ok = true
	}
	count, valid := raw["totalCount"].(float64)
	if !ok || !valid || count < 0 || count != float64(int64(count)) || count < float64(len(items)) {
		return nil, errors.New("CLI returned an incomplete or unrecognized findings report")
	}
	if raw["scanID"] != nil && raw["scanID"] != id {
		return nil, errors.New("CLI report belongs to a different scan")
	}
	findings, err := normalizeFindings(items, id, str(scan, "projectId"), c.connection)
	if err != nil {
		return nil, err
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err = e.checkConnection(c); err != nil {
		return nil, err
	}
	unsupported := 0
	for _, f := range findings {
		if !contains([]string{"sast", "sca", "kics", "iac-security", "secrets"}, str(f, "type")) {
			unsupported++
		}
	}
	page := Object{"scan": scan, "connectionId": c.connection, "importedAt": now(), "cached": false, "findings": findings, "totalCount": count, "truncated": count != float64(len(items)), "counts": Object{"reported": count, "received": len(items), "normalized": len(findings), "unsupported": unsupported}}
	jobs, err := e.store.list("job", &c.connection)
	if err != nil {
		return nil, err
	}
	for _, job := range jobs {
		if str(job, "scanId") == id && job["provenance"] != nil {
			page["provenance"] = job["provenance"]
			scan["provenance"] = job["provenance"]
			break
		}
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err = e.store.saveSnapshot(c.connection, page); err != nil {
		return nil, err
	}
	return page, nil
}
func (e *Engine) session(id string) (Object, error) {
	connection, err := e.connection(true)
	if err != nil {
		return nil, err
	}
	s, err := e.store.get("session", connection, id)
	if err != nil {
		return nil, err
	}
	if s == nil {
		return nil, errors.New("Session is unavailable in the current connection")
	}
	return s, nil
}
func (e *Engine) createSession(ctx context.Context, input Object) (Object, error) {
	title, err := bounded(input["title"], "Title", 200)
	if err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, errors.New("Give the remediation session a title")
	}
	page, err := e.results(ctx, str(input, "scanId"), Object{})
	if err != nil {
		return nil, err
	}
	scan := object(page["scan"])
	if str(scan, "projectId") == "" {
		return nil, errors.New("Select an imported scan first")
	}
	ids := stringsOf(input["findingIds"])
	if len(ids) == 0 || len(ids) > 100000 || len(ids) != len(array(input["findingIds"])) {
		return nil, errors.New("Select valid findings for this session")
	}
	known := map[string]bool{}
	for _, f := range objects(page["findings"]) {
		known[str(f, "id")] = true
	}
	unique := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		if !known[id] {
			return nil, errors.New("Selection contains findings outside the baseline")
		}
		if !seen[id] {
			unique = append(unique, id)
			seen[id] = true
		}
	}
	folder := str(input, "folderPath")
	source := object(provenance(page)["source"])
	if folder != "" {
		folder, err = e.requireFolder(folder)
		if err != nil {
			return nil, err
		}
		b, err := e.store.get("binding", pageConnection(page), strings.ToLower(folder))
		if err != nil {
			return nil, err
		}
		if str(b, "projectId") != str(scan, "projectId") {
			return nil, errors.New("Link the folder to this scan's project first")
		}
		if str(source, "folderPath") != "" && folder != str(source, "folderPath") {
			return nil, errors.New("Selected folder differs from scan provenance")
		}
	} else {
		folder = str(source, "folderPath")
	}
	s := Object{"id": uuid(), "connectionId": pageConnection(page), "title": title, "baselineScanId": str(scan, "id"), "projectId": str(scan, "projectId"), "projectName": str(scan, "projectName"), "folderPath": folder, "findingIds": unique, "status": "open", "createdAt": now(), "updatedAt": now(), "notes": "", "changeRef": "", "checks": ""}
	if input["handoff"] != nil {
		handoff, err := bounded(input["handoff"], "Handoff", 8<<20)
		if err != nil {
			return nil, err
		}
		s["handoff"] = handoff
	}
	err = e.store.save(record{kind: "session", scope: pageConnection(page), id: str(s, "id"), value: s}, record{kind: "baseline", scope: pageConnection(page), id: str(s, "id"), value: page, immutable: true})
	return s, err
}
func (e *Engine) updateSession(input Object) (Object, error) {
	e.sessionMu.Lock()
	defer e.sessionMu.Unlock()
	s, err := e.session(str(input, "id"))
	if err != nil {
		return nil, err
	}
	for _, field := range []string{"title", "notes", "changeRef", "checks", "handoff"} {
		if input[field] != nil {
			limit := 32768
			if field == "title" {
				limit = 200
			} else if field == "handoff" {
				limit = 8 << 20
			}
			s[field], err = bounded(input[field], field, limit)
			if err != nil {
				return nil, err
			}
		}
	}
	if strings.TrimSpace(str(s, "title")) == "" {
		return nil, errors.New("Give the session a title")
	}
	if input["status"] != nil {
		v := str(input, "status")
		if !contains([]string{"open", "in_progress", "awaiting_verification"}, v) {
			return nil, errors.New("Only a scan comparison can establish verification status")
		}
		s["status"] = v
	}
	s["updatedAt"] = now()
	err = e.store.save(record{kind: "session", scope: str(s, "connectionId"), id: str(s, "id"), value: s})
	return s, err
}
func (e *Engine) verifySession(ctx context.Context, id, scanID string) (Object, error) {
	s, err := e.session(id)
	if err != nil {
		return nil, err
	}
	if scanID == str(s, "baselineScanId") {
		return nil, errors.New("Choose a later scan to verify this remediation")
	}
	baseline, err := e.store.get("baseline", str(s, "connectionId"), id)
	if err != nil {
		return nil, err
	}
	if baseline == nil {
		return nil, errors.New("Original session evidence is unavailable")
	}
	current, err := e.results(ctx, scanID, Object{"refresh": true})
	if err != nil {
		return nil, err
	}
	scan := object(current["scan"])
	if str(scan, "projectId") != str(s, "projectId") || pageConnection(current) != str(s, "connectionId") {
		return nil, errors.New("Verification belongs to another project or connection")
	}
	if str(scan, "status") != "Completed" {
		return nil, errors.New("Wait for a completed verification scan")
	}
	bt, be := parseTime(object(baseline["scan"])["createdAt"])
	ct, ce := parseTime(scan["createdAt"])
	if be != nil || ce != nil || !bt.Before(ct) {
		return nil, errors.New("Verification requires a completed scan later than the baseline")
	}
	comparison := compareScans(baseline, current)
	remaining, absent := verifySelected(baseline, current, stringsOf(s["findingIds"]), comparison)
	newIDs := []string{}
	for _, f := range objects(current["findings"]) {
		if object(comparison["changes"])[str(f, "id")] == "NEW" {
			newIDs = append(newIDs, str(f, "id"))
		}
	}
	e.sessionMu.Lock()
	defer e.sessionMu.Unlock()
	s, err = e.session(id)
	if err != nil {
		return nil, err
	}
	s["status"] = "unresolved"
	if str(comparison, "compatibility") == "comparable" && str(comparison, "verdict") == "pass" && len(remaining) == 0 {
		s["status"] = "verified"
	}
	s["updatedAt"] = now()
	s["verification"] = Object{"scanId": scanID, "checkedAt": now(), "comparison": comparison, "remainingIds": remaining, "absentIds": absent, "newIds": newIDs}
	err = e.store.save(record{kind: "session", scope: str(s, "connectionId"), id: id, value: s}, record{kind: "verification", scope: str(s, "connectionId"), id: id, value: current})
	return s, err
}
func (e *Engine) bundle(id string) (Object, error) {
	s, err := e.session(id)
	if err != nil {
		return nil, err
	}
	baseline, err := e.store.get("baseline", str(s, "connectionId"), id)
	if err != nil {
		return nil, err
	}
	if baseline == nil {
		return nil, errors.New("Original session evidence is unavailable")
	}
	verification, err := e.store.get("verification", str(s, "connectionId"), id)
	if err != nil {
		return nil, err
	}
	b := Object{"format": "marx-remediation", "version": 1, "exportedAt": time.Now().UTC().Format(time.RFC3339Nano), "session": s, "baseline": baseline}
	if verification != nil {
		b["verification"] = verification
	}
	return b, nil
}
func (e *Engine) bootstrap() (Object, error) {
	connection, err := e.connection(true)
	if err != nil {
		return Object{"connectionId": nil, "jobs": []Object{}, "sessions": []Object{}, "scans": []Object{}, "logs": Object{}}, nil
	}
	jobs, err := e.store.list("job", &connection)
	if err != nil {
		return nil, err
	}
	sessions, err := e.store.list("session", &connection)
	if err != nil {
		return nil, err
	}
	pages, err := e.store.list("snapshot", &connection)
	if err != nil {
		return nil, err
	}
	scans := []Object{}
	for _, p := range pages {
		scans = append(scans, object(p["scan"]))
	}
	logs := Object{}
	for _, j := range jobs {
		lines, err := e.store.logs(str(j, "id"))
		if err != nil {
			return nil, err
		}
		logs[str(j, "id")] = lines
	}
	return Object{"connectionId": connection, "jobs": jobs, "sessions": sessions, "scans": scans, "logs": logs}, nil
}
