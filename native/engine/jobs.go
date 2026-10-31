package engine

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

func (e *Engine) prepareJob(ctx context.Context, input Object) (Object, *CLI, error) {
	folder, err := e.requireFolder(str(input, "folderPath"))
	if err != nil {
		return nil, nil, err
	}
	c, err := e.client()
	if err != nil {
		return nil, nil, err
	}
	if project := str(input, "projectId"); project != "" {
		b, err := e.store.get("binding", c.connection, strings.ToLower(folder))
		if err != nil {
			return nil, nil, err
		}
		if str(b, "projectId") != project || str(b, "projectName") != str(input, "projectName") {
			return nil, nil, errors.New("Confirm the repository-to-project mapping before scanning")
		}
	}
	options := clone(object(input["options"]))
	job := Object{"id": uuid(), "folderPath": folder, "projectName": str(input, "projectName"), "projectId": str(input, "projectId"), "branch": str(options, "branch"), "options": options, "connectionId": c.connection, "monitoringStatus": "active", "progress": Object{"phase": "idle"}, "status": "Unknown", "startedAt": now()}
	if _, err = buildScanArgs(job); err != nil {
		return nil, nil, err
	}
	version, _, err := c.preflight(ctx)
	if err != nil {
		return nil, nil, err
	}
	job["provenance"] = captureProvenance(ctx, folder, options, c.connection, version)
	if err = e.checkConnection(c); err != nil {
		return nil, nil, err
	}
	settings := e.getSettings()
	recent := []string{folder}
	for _, s := range stringsOf(settings["recentFolders"]) {
		if !strings.EqualFold(s, folder) && len(recent) < 8 {
			recent = append(recent, s)
		}
	}
	if _, err = e.saveSettings(Object{"recentFolders": recent}); err != nil {
		return nil, nil, err
	}
	return job, c, nil
}
func (e *Engine) startJob(job Object, c *CLI, resume bool) (Object, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return nil, errors.New("Marx is shutting down")
	}
	if current := e.active[str(job, "id")]; current != nil {
		return clone(current.job), nil
	}
	if len(e.active) >= 8 {
		return nil, errors.New("Eight scans are already active; wait for one to finish")
	}
	if resume && str(job, "scanId") == "" {
		return nil, errors.New("No remote scan ID is known; check Checkmarx One before retrying")
	}
	if str(job, "connectionId") != c.connection {
		return nil, errors.New("Restore the job's original CLI connection before reconciling")
	}
	working := clone(job)
	ctx, cancel := context.WithCancel(e.ctx)
	active := &activeJob{cancel: cancel, client: c, job: working}
	if err := e.store.saveJob(working); err != nil {
		cancel()
		return nil, err
	}
	e.active[str(job, "id")] = active
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		defer cancel()
		e.executeJob(ctx, active, resume)
		e.mu.Lock()
		delete(e.active, str(job, "id"))
		e.mu.Unlock()
	}()
	return clone(working), nil
}
func (e *Engine) jobUpdate(active *activeJob, patch Object) {
	e.mu.Lock()
	for k, v := range patch {
		if v == nil {
			delete(active.job, k)
		} else {
			active.job[k] = v
		}
	}
	job := clone(active.job)
	e.mu.Unlock()
	if err := e.store.saveJob(job); err != nil {
		e.emit(Object{"kind": "log", "jobId": job["id"], "line": "Local history could not be saved; keep Marx open until this scan settles."})
	}
	e.emit(Object{"kind": "job-updated", "job": job})
}
func (e *Engine) log(active *activeJob, line string) {
	line = active.client.redact(line)
	e.mu.Lock()
	id := str(active.job, "id")
	e.mu.Unlock()
	_ = e.store.appendLog(id, line)
	e.emit(Object{"kind": "log", "jobId": id, "line": line})
}
func (e *Engine) executeJob(ctx context.Context, a *activeJob, resume bool) {
	job, c := a.job, a.client
	expectedProject := str(job, "projectId")
	submitting := false
	remoteStatus := ""
	var runErr error
	update := func(p Object) { e.jobUpdate(a, p) }
	log := func(s string) { e.log(a, s) }
	if resume {
		update(Object{"finishedAt": nil, "error": nil, "monitoringStatus": "reconciling", "progress": Object{"phase": "running", "detail": "Checking the known remote scan. No new scan will be submitted."}})
	} else {
		update(Object{"progress": Object{"phase": "submitting", "detail": "The official CLI is preparing and uploading source."}})
		log("Starting the official Checkmarx CLI.")
		args, err := buildScanArgs(job)
		if err != nil {
			runErr = err
		} else {
			_, flags, err := c.preflight(ctx)
			runErr = err
			if runErr == nil {
				for _, arg := range args {
					if strings.HasPrefix(arg, "--") {
						name, _, _ := strings.Cut(arg[2:], "=")
						if !flags[name] {
							runErr = fmt.Errorf("CLI does not support --%s; no upload was started", name)
							break
						}
					}
				}
			}
			if runErr == nil {
				runErr = e.validateRemoteProject(ctx, c, job)
			}
			if runErr == nil {
				runErr = e.checkConnection(c)
			}
			if runErr == nil {
				runErr = ctx.Err()
			}
			if runErr == nil {
				submitting = true
				output, err := c.command(ctx, args, 30*time.Minute, func(line string) {
					if strings.HasPrefix(strings.TrimSpace(line), "{") {
						if raw, err := parseJSON(line); err == nil {
							if scan, err := scanFromCLI(raw); err == nil {
								patch := Object{"scanId": scan["id"]}
								if expectedProject == "" {
									patch["projectId"] = scan["projectId"]
								}
								update(patch)
							}
						}
					}
					log(line)
				}, false)
				runErr = err
				if err == nil {
					raw, err := parseJSON(output)
					runErr = err
					if err == nil {
						scan, err := scanFromCLI(raw)
						runErr = err
						if err == nil {
							expected := expectedProject
							patch := Object{"scanId": scan["id"]}
							if expectedProject == "" {
								patch["projectId"] = scan["projectId"]
							}
							update(patch)
							if expected != "" && expected != str(scan, "projectId") {
								_, cancelErr := c.command(context.Background(), []string{"scan", "cancel", "--scan-id=" + str(scan, "id"), "--retry=0"}, time.Minute, nil, false)
								if cancelErr != nil {
									runErr = errors.New("CLI created a scan in a different project; remote cancellation is unconfirmed")
								} else {
									runErr = errors.New("CLI created a scan in a different project; cancellation was requested")
								}
							} else {
								submitting = false
								update(Object{"status": scan["status"], "progress": Object{"phase": "queued"}})
								_ = e.store.save(record{kind: "binding", scope: c.connection, id: strings.ToLower(str(job, "folderPath")), value: Object{"folderPath": job["folderPath"], "projectId": job["projectId"], "projectName": job["projectName"], "connectionId": c.connection}})
							}
						}
					}
				}
			}
		}
	}
	if runErr == nil {
		deadline := time.Now().Add(24 * time.Hour)
		unknown := 0
		for {
			if ctx.Err() != nil {
				runErr = ctx.Err()
				break
			}
			if time.Now().After(deadline) {
				runErr = errors.New("Scan polling timed out after 24 hours")
				break
			}
			scan, err := c.scan(ctx, str(job, "scanId"))
			if err != nil {
				runErr = err
				break
			}
			if str(scan, "projectId") != str(job, "projectId") {
				runErr = errors.New("Remote scan belongs to a different project")
				break
			}
			s := str(scan, "status")
			if terminal(s) {
				remoteStatus = s
				break
			}
			if s == "Unknown" {
				unknown++
				if unknown >= 3 {
					runErr = errors.New("CLI repeatedly reported an unrecognized scan status")
					break
				}
			} else {
				unknown = 0
			}
			phase := "running"
			if s == "Queued" {
				phase = "queued"
			}
			update(Object{"status": s, "progress": Object{"phase": phase}})
			select {
			case <-ctx.Done():
				runErr = ctx.Err()
			case <-time.After(5 * time.Second):
			}
			if runErr != nil {
				break
			}
		}
	}
	if runErr == nil && remoteStatus == "Failed" {
		runErr = errors.New("Remote scan failed")
	}
	if runErr == nil && remoteStatus == "Canceled" {
		runErr = errors.New("Remote scan cancellation confirmed")
	}
	if runErr == nil {
		update(Object{"status": remoteStatus, "progress": Object{"phase": "fetching-results"}})
		summary, err := e.summary(ctx, c, str(job, "scanId"))
		if ctx.Err() != nil {
			runErr = ctx.Err()
		} else {
			patch := Object{"status": remoteStatus, "finishedAt": now(), "monitoringStatus": "stopped", "progress": Object{"phase": "completed", "detail": "Results are available; engine coverage must be reviewed."}}
			if err == nil && summary != nil {
				patch["summary"] = summary
			} else {
				log("Summary unavailable; open results to inspect findings.")
			}
			update(patch)
			log("Scan monitoring completed.")
			e.notify(job)
			return
		}
	}
	if runErr != nil {
		message := runErr.Error()
		s := "Failed"
		if str(job, "scanId") != "" && remoteStatus != "Failed" {
			s = "Unknown"
		}
		if submitting && str(job, "scanId") == "" {
			s = "Unknown"
			message += " No scan ID was received. Remote submission is unconfirmed; check Checkmarx One before retrying."
		}
		if remoteStatus == "Canceled" {
			s = "Canceled"
		}
		if ctx.Err() != nil {
			e.mu.Lock()
			shutdown := e.closed
			e.mu.Unlock()
			if shutdown {
				update(Object{"status": "Unknown", "finishedAt": now(), "monitoringStatus": "stopped", "error": "Local monitoring stopped during shutdown; reconcile the remote outcome.", "progress": Object{"phase": "failed"}})
				return
			}
			if str(job, "scanId") != "" {
				s, message = e.cancelRemote(c, str(job, "scanId"))
			} else if !submitting {
				s = "Canceled"
				message = "Local job canceled before submission."
			} else {
				s = "Unknown"
				message = "Local submission stopped without a scan ID. Remote cancellation is unconfirmed; check Checkmarx One before retrying."
			}
		}
		phase := "failed"
		if s == "Canceled" {
			phase = "canceled"
		} else if s == "Completed" || s == "Partial" {
			phase = "completed"
		}
		update(Object{"status": s, "finishedAt": now(), "monitoringStatus": "stopped", "error": message, "progress": Object{"phase": phase, "detail": message}})
		log(message)
		e.notify(job)
	}
}
func (e *Engine) validateRemoteProject(ctx context.Context, c *CLI, job Object) error {
	v, err := c.json(ctx, "project", "list", "--format=json", "--filter="+csvValue("name="+str(job, "projectName"))+",limit=1000")
	if err != nil {
		return err
	}
	items, ok := v.([]any)
	if !ok || len(items) >= 1000 {
		return errors.New("Project lookup is incomplete")
	}
	matches := []Object{}
	for _, item := range items {
		p, err := projectFromCLI(item)
		if err != nil {
			return err
		}
		if str(p, "name") == str(job, "projectName") {
			matches = append(matches, p)
		}
	}
	id := str(job, "projectId")
	if len(matches) > 1 || (id != "" && (len(matches) != 1 || str(matches[0], "id") != id)) {
		return errors.New("Selected project does not resolve uniquely by name; refresh projects")
	}
	if id == "" && len(matches) > 0 {
		return errors.New("A project with this name already exists; select and bind it explicitly")
	}
	return nil
}
func (e *Engine) cancelRemote(c *CLI, id string) (string, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	_, err := c.command(ctx, []string{"scan", "cancel", "--scan-id=" + id, "--retry=0"}, time.Minute, nil, false)
	if err != nil {
		return "Unknown", "Remote cancellation is unconfirmed: " + err.Error()
	}
	scan, err := c.scan(ctx, id)
	if err != nil {
		return "Unknown", "Cancellation was requested; the remote outcome remains unconfirmed"
	}
	s := str(scan, "status")
	if s == "Canceled" {
		return s, "Remote scan cancellation confirmed."
	}
	return s, "Cancellation was requested; the remote scan is " + strings.ToLower(s) + ". Reconcile to check its outcome."
}
func (e *Engine) notify(job Object) {
	_, err := e.native("notification", Object{"id": str(job, "id"), "title": "Scan " + strings.ToLower(str(job, "status")), "body": str(job, "projectName") + ": open Marx to review its outcome."})
	message := "Desktop notification submitted to Windows."
	if err != nil {
		message = "Desktop notification unavailable: " + err.Error()
		if home, homeErr := os.UserHomeDir(); homeErr == nil {
			message = strings.ReplaceAll(message, home, "%USERPROFILE%")
			message = strings.ReplaceAll(message, strings.ReplaceAll(home, "\\", "/"), "%USERPROFILE%")
		}
		if len(message) > 2048 {
			message = message[:2048]
		}
	}
	id := str(job, "id")
	_ = e.store.appendLog(id, message)
	e.emit(Object{"kind": "log", "jobId": id, "line": message})
}
func (e *Engine) NotificationClick(id string) {
	jobs, err := e.store.list("job", nil)
	if err != nil {
		return
	}
	for _, job := range jobs {
		if str(job, "id") == id && str(job, "scanId") != "" {
			e.emit(Object{"kind": "open-results", "scanId": job["scanId"], "folderPath": job["folderPath"]})
			break
		}
	}
	_, _ = e.native("show", Object{})
}
func (e *Engine) summary(ctx context.Context, c *CLI, id string) (Object, error) {
	data, err := c.report(ctx, id, "summaryJSON")
	if err != nil {
		return nil, err
	}
	raw, err := parseJSON(string(data))
	if err != nil {
		return nil, err
	}
	m := object(raw)
	counts := Object{"UNKNOWN": 0}
	for _, p := range [][2]string{{"CRITICAL", "CriticalIssues"}, {"HIGH", "HighIssues"}, {"MEDIUM", "MediumIssues"}, {"LOW", "LowIssues"}, {"INFO", "InfoIssues"}} {
		v, ok := m[p[1]].(float64)
		if !ok || v < 0 || v != float64(int64(v)) {
			return nil, nil
		}
		counts[p[0]] = v
	}
	return counts, nil
}
