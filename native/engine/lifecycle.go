package engine

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

func (e *Engine) runBatch(ctx context.Context, input Object) (any, error) {
	items := objects(input["items"])
	if len(items) == 0 || len(items) > 200 {
		return nil, errors.New("Choose between 1 and 200 batch projects")
	}
	e.mu.Lock()
	if e.batch {
		e.mu.Unlock()
		return nil, errors.New("A batch is already running")
	}
	e.batch = true
	e.mu.Unlock()
	started := false
	defer func() {
		if !started {
			e.mu.Lock()
			e.batch = false
			e.mu.Unlock()
		}
	}()
	seen := map[string]bool{}
	jobs := []Object{}
	clients := []*CLI{}
	batch := uuid()
	connection := ""
	for _, item := range items {
		folder, err := e.requireFolder(str(item, "folderPath"))
		if err != nil {
			return nil, err
		}
		key := pathIdentity(folder)
		if seen[key] {
			return nil, errors.New("The batch contains the same folder more than once")
		}
		seen[key] = true
		options := clone(object(item["options"]))
		if len(options) == 0 {
			options = clone(object(input["options"]))
		}
		git := gitInfo(ctx, folder)
		if boolean(git["hasGit"]) || strings.TrimSpace(str(options, "branch")) == "" {
			options["branch"] = git["branch"]
		}
		item = clone(item)
		item["options"] = options
		item["folderPath"] = folder
		job, c, err := e.prepareJob(ctx, item)
		if err != nil {
			return nil, err
		}
		if connection != "" && connection != c.connection {
			return nil, errors.New("Connection changed while preparing the batch")
		}
		connection = c.connection
		job["batchId"] = batch
		jobs = append(jobs, job)
		clients = append(clients, c)
	}
	if err := e.checkConnection(clients[0]); err != nil {
		return nil, err
	}
	records := []record{}
	for _, job := range jobs {
		records = append(records, record{kind: "job", scope: connection, id: str(job, "id"), value: job})
	}
	e.mu.Lock()
	if e.closed {
		e.mu.Unlock()
		return nil, errors.New("Marx is shutting down")
	}
	if err := e.store.save(records...); err != nil {
		e.mu.Unlock()
		return nil, err
	}
	e.wg.Add(1)
	e.mu.Unlock()
	started = true
	e.emit(Object{"kind": "job-list", "jobs": jobs})
	concurrency := integer(input["concurrency"], 2, 1, 4)
	go func() {
		defer e.wg.Done()
		defer func() { e.mu.Lock(); e.batch = false; e.mu.Unlock() }()
		var workers sync.WaitGroup
		queue := make(chan int)
		for range concurrency {
			workers.Add(1)
			go func() {
				defer workers.Done()
				for i := range queue {
					job := jobs[i]
					e.mu.Lock()
					canceled := e.canceled[str(job, "id")]
					e.mu.Unlock()
					if canceled || e.ctx.Err() != nil {
						job = clone(job)
						job["status"] = "Canceled"
						job["finishedAt"] = now()
						job["monitoringStatus"] = "stopped"
						job["progress"] = Object{"phase": "canceled"}
						_ = e.store.saveJob(job)
						e.emit(Object{"kind": "job-updated", "job": job})
						continue
					}
					_, err := e.startJob(job, clients[i], false)
					if err != nil {
						job = clone(job)
						job["status"] = "Failed"
						job["finishedAt"] = now()
						job["monitoringStatus"] = "stopped"
						job["error"] = err.Error()
						job["progress"] = Object{"phase": "failed"}
						_ = e.store.saveJob(job)
						e.emit(Object{"kind": "job-updated", "job": job})
						continue
					}
					for {
						e.mu.Lock()
						active := e.active[str(job, "id")] != nil
						e.mu.Unlock()
						if !active {
							break
						}
						select {
						case <-e.ctx.Done():
							return
						case <-time.After(100 * time.Millisecond):
						}
					}
				}
			}()
		}
		for i := range jobs {
			select {
			case queue <- i:
			case <-e.ctx.Done():
				close(queue)
				workers.Wait()
				return
			}
		}
		close(queue)
		workers.Wait()
	}()
	return jobs, nil
}
func (e *Engine) runVerification(ctx context.Context, id string) (any, error) {
	e.mu.Lock()
	if e.preparing[id] {
		e.mu.Unlock()
		return nil, errors.New("This verification is already being prepared")
	}
	e.preparing[id] = true
	e.mu.Unlock()
	defer func() { e.mu.Lock(); delete(e.preparing, id); e.mu.Unlock() }()
	s, err := e.session(id)
	if err != nil {
		return nil, err
	}
	e.mu.Lock()
	running := e.active[str(s, "verificationJobId")] != nil
	e.mu.Unlock()
	if running {
		return nil, errors.New("This session already has a running verification scan")
	}
	baseline, err := e.store.get("baseline", str(s, "connectionId"), id)
	if err != nil {
		return nil, err
	}
	p := provenance(baseline)
	if len(p) == 0 || str(s, "folderPath") == "" {
		return nil, errors.New("This imported scan has no recorded local options; run a local scan first")
	}
	options := clone(object(p["options"]))
	git := gitInfo(ctx, str(s, "folderPath"))
	if boolean(git["hasGit"]) || strings.TrimSpace(str(options, "branch")) == "" {
		options["branch"] = git["branch"]
	}
	job, c, err := e.prepareJob(ctx, Object{"folderPath": s["folderPath"], "projectName": s["projectName"], "projectId": s["projectId"], "options": options})
	if err != nil {
		return nil, err
	}
	e.sessionMu.Lock()
	defer e.sessionMu.Unlock()
	s, err = e.session(id)
	if err != nil {
		return nil, err
	}
	if c.connection != str(s, "connectionId") {
		return nil, errors.New("Restore the session's original connection")
	}
	s["verificationJobId"] = job["id"]
	s["status"] = "awaiting_verification"
	s["updatedAt"] = now()
	return e.startJobWithRecords(job, c, false, record{kind: "session", scope: c.connection, id: id, value: s})
}
func (e *Engine) deleteSession(id string) error {
	e.sessionMu.Lock()
	defer e.sessionMu.Unlock()
	s, err := e.session(id)
	if err != nil {
		return err
	}
	e.mu.Lock()
	active := e.active[str(s, "verificationJobId")] != nil
	preparing := e.preparing[id]
	e.mu.Unlock()
	if active || preparing {
		return errors.New("Wait for verification to finish before deleting this session")
	}
	e.store.mu.Lock()
	defer e.store.mu.Unlock()
	tx, err := e.store.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, kind := range []string{"session", "baseline", "verification"} {
		if _, err = tx.Exec("DELETE FROM records WHERE kind=? AND scope=? AND id=?", kind, str(s, "connectionId"), id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (e *Engine) referenced(connection, id string) (bool, error) {
	sessions, err := e.store.list("session", &connection)
	if err != nil {
		return false, err
	}
	for _, s := range sessions {
		if str(s, "baselineScanId") == id || str(object(s["verification"]), "scanId") == id {
			return true, nil
		}
	}
	jobs, err := e.store.list("job", &connection)
	if err != nil {
		return false, err
	}
	for _, j := range jobs {
		if str(j, "scanId") == id && (!terminal(str(j, "status")) || number(j["finishedAt"]) == 0) {
			return true, nil
		}
	}
	return false, nil
}
func (e *Engine) deleteSnapshot(connection, id string) error {
	e.sessionMu.Lock()
	defer e.sessionMu.Unlock()
	referenced, err := e.referenced(connection, id)
	if err != nil {
		return err
	}
	if referenced {
		return errors.New("This scan is referenced by a session or unresolved job")
	}
	return e.store.remove("snapshot", connection, id)
}
func (e *Engine) prune(days int) error {
	e.sessionMu.Lock()
	defer e.sessionMu.Unlock()
	cutoff := now() - int64(days)*86400000
	pages, err := e.store.list("snapshot", nil)
	if err != nil {
		return err
	}
	for _, page := range pages {
		connection, id := pageConnection(page), str(object(page["scan"]), "id")
		if number(page["importedAt"]) >= float64(cutoff) {
			continue
		}
		ref, err := e.referenced(connection, id)
		if err != nil {
			return err
		}
		if !ref {
			if err = e.store.remove("snapshot", connection, id); err != nil {
				return err
			}
		}
	}
	sessions, err := e.store.list("session", nil)
	if err != nil {
		return err
	}
	retained := map[string]bool{}
	for _, s := range sessions {
		retained[str(s, "verificationJobId")] = true
	}
	jobs, err := e.store.list("job", nil)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		id := str(job, "id")
		if retained[id] || !terminal(str(job, "status")) || number(job["finishedAt"]) == 0 || number(job["finishedAt"]) >= float64(cutoff) {
			continue
		}
		if err = e.store.remove("job", str(job, "connectionId"), id); err != nil {
			return err
		}
		if _, err = e.store.db.Exec("DELETE FROM logs WHERE job_id=?", id); err != nil {
			return err
		}
	}
	return nil
}
