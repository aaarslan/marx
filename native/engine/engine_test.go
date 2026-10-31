package engine

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

var fixtureExecutable string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "marx-go-fixture-")
	if err != nil {
		os.Exit(1)
	}
	fixtureExecutable = filepath.Join(dir, "cx.exe")
	cmd := exec.Command("go", "build", "-trimpath", "-buildvcs=false", "-o", fixtureExecutable, "../../scripts/fixtures/cli")
	if output, err := cmd.CombinedOutput(); err != nil {
		os.Stderr.Write(output)
		os.RemoveAll(dir)
		os.Exit(1)
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

type testFixture struct {
	e                                *Engine
	root, source, profile, downloads string
	events                           chan Object
}

func fixture(t *testing.T) *testFixture {
	t.Helper()
	root := t.TempDir()
	source := filepath.Join(root, "source space (native) [1] 日本語")
	profile := filepath.Join(root, "profile")
	downloads := filepath.Join(root, "downloads")
	for _, dir := range []string{source, profile, downloads} {
		if os.MkdirAll(dir, 0700) != nil {
			t.Fatal("Fixture directory creation failed")
		}
	}
	if os.WriteFile(filepath.Join(source, "index.js"), []byte("synthetic\nsource\n"), 0600) != nil {
		t.Fatal("Fixture source creation failed")
	}
	t.Setenv("MARX_FIXTURE_ROOT", root)
	for _, key := range []string{"CX_APIKEY", "CX_CLIENT_SECRET", "CX_CLIENT_ID", "CX_CONFIG_FILE_PATH"} {
		t.Setenv(key, "")
	}
	events := make(chan Object, 1000)
	host := Host{Downloads: downloads, Emit: func(event Object) {
		select {
		case events <- event:
		default:
		}
	}, Protect: func(mode string, b []byte) ([]byte, error) {
		if mode == "protect" {
			return append([]byte("protected:"), b...), nil
		}
		if !strings.HasPrefix(string(b), "protected:") {
			return nil, errors.New("Invalid protected blob")
		}
		return b[len("protected:"):], nil
	}, Native: func(name string, p Object) (any, error) {
		if name == "save" {
			return Object{"filePath": filepath.Join(downloads, filepath.Base(str(p, "defaultPath")))}, nil
		}
		return nil, nil
	}}
	e, err := Open(profile, host)
	if err != nil {
		t.Fatal("Engine fixture did not open")
	}
	t.Cleanup(e.Close)
	if _, err = e.saveSettings(Object{"cliPath": fixtureExecutable, "cliAuthMode": "cli", "recentFolders": []string{source}}); err != nil {
		t.Fatal("Fixture settings failed")
	}
	if _, err = e.grant(source); err != nil {
		t.Fatal("Fixture source authorization failed")
	}
	c, err := e.client()
	if err != nil {
		t.Fatal("Fixture CLI resolution failed")
	}
	if err = e.store.save(record{kind: "binding", scope: c.connection, id: strings.ToLower(source), value: Object{"folderPath": source, "projectId": "p1", "projectName": "synthetic-fixture", "connectionId": c.connection}}); err != nil {
		t.Fatal("Fixture mapping failed")
	}
	return &testFixture{e, root, source, profile, downloads, events}
}
func (f *testFixture) marker(t *testing.T, name string) {
	t.Helper()
	if os.WriteFile(filepath.Join(f.root, name), []byte("synthetic"), 0600) != nil {
		t.Fatal("Fixture marker failed")
	}
}
func (f *testFixture) input() Object {
	return Object{"folderPath": f.source, "projectName": "synthetic-fixture", "projectId": "p1", "options": Object{"scanners": []string{"sast"}, "branch": "main", "sastPreset": "", "sastIncremental": false, "scaExploitablePath": false, "excludes": []string{}, "tags": Object{}}}
}
func invoke(t *testing.T, e *Engine, ch string, args ...any) any {
	t.Helper()
	raw := []json.RawMessage{}
	for _, a := range args {
		raw = append(raw, jsonValue(a))
	}
	v, err := e.Invoke(ch, raw)
	if err != nil {
		t.Fatalf("Operation %s failed: %s", ch, err)
	}
	return v
}
func invokeError(t *testing.T, e *Engine, ch string, args ...any) {
	t.Helper()
	raw := []json.RawMessage{}
	for _, a := range args {
		raw = append(raw, jsonValue(a))
	}
	if _, err := e.Invoke(ch, raw); err == nil {
		t.Fatalf("Operation %s should have failed", ch)
	}
}
func settled(t *testing.T, f *testFixture, id string) Object {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		c, err := f.e.client()
		if err != nil {
			t.Fatal("Fixture connection unavailable")
		}
		job, err := f.e.store.get("job", c.connection, id)
		if err != nil {
			t.Fatal("Job persistence failed")
		}
		if number(job["finishedAt"]) > 0 {
			return job
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("Job did not settle")
	return nil
}
func awaitMarker(t *testing.T, f *testFixture, name string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(filepath.Join(f.root, name)); err == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("Synthetic CLI did not reach expected stage")
}
func TestWorkflowPersistenceAndOriginalEvidence(t *testing.T) {
	f := fixture(t)
	job := object(invoke(t, f.e, "scan:run", f.input()))
	if s := str(settled(t, f, str(job, "id")), "status"); s != "Completed" {
		t.Fatalf("Expected Completed, got %s", s)
	}
	large := object(invoke(t, f.e, "results:get", "large-paging"))
	if len(array(large["findings"])) != 5051 || boolean(large["truncated"]) {
		t.Fatal("Large results were truncated")
	}
	page := object(invoke(t, f.e, "results:query", "large-paging", Object{"offset": 5000, "limit": 100}))
	if len(array(page["findings"])) != 51 || number(page["filteredCount"]) != 5051 {
		t.Fatal("Paging lost findings")
	}
	s := object(invoke(t, f.e, "session:create", Object{"title": "Synthetic remediation", "scanId": "s1", "findingIds": []string{"finding-1"}, "folderPath": f.source, "handoff": "Synthetic handoff"}))
	id := str(s, "id")
	invoke(t, f.e, "session:update", Object{"id": id, "notes": "Synthetic notes", "checks": "Synthetic checks", "changeRef": "synthetic-ref", "status": "in_progress"})
	f.marker(t, "changedEvidence")
	refreshed := object(invoke(t, f.e, "results:get", "s1", Object{"refresh": true}))
	if len(array(refreshed["findings"])) != 20 {
		t.Fatal("Refresh did not use new report")
	}
	bundle := object(invoke(t, f.e, "session:evidence", id))
	if len(array(object(bundle["baseline"])["findings"])) != 21 {
		t.Fatal("Original evidence was overwritten")
	}
	verified := object(invoke(t, f.e, "session:verify", Object{"id": id, "scanId": "s2"}))
	if str(verified, "status") != "unresolved" || str(object(object(verified["verification"])["comparison"]), "verdict") != "inconclusive" {
		t.Fatal("Unverified coverage claimed remediation success")
	}
	invokeError(t, f.e, "snapshot:delete", "s1")
	invoke(t, f.e, "workspace:save", "test", Object{"search": "persisted"})
	f.e.Close()
	reopened, err := Open(f.profile, f.e.host)
	if err != nil {
		t.Fatal("Database reopen failed")
	}
	defer reopened.Close()
	if str(object(invoke(t, reopened, "workspace:get", "test")), "search") != "persisted" {
		t.Fatal("Workspace was not persisted")
	}
	s, err = reopened.session(id)
	if err != nil || str(s, "notes") != "Synthetic notes" {
		t.Fatal("Session was not persisted")
	}
	invoke(t, reopened, "session:delete", id)
	invoke(t, reopened, "snapshot:delete", "s1")
}
func TestSubmissionAndRemoteOutcomes(t *testing.T) {
	for _, test := range []struct{ name, marker, want string }{{"completed", "", "Completed"}, {"partial", "partial", "Partial"}, {"failed", "failed", "Failed"}, {"canceled", "canceled", "Canceled"}, {"uncertain response", "streamThenFail", "Unknown"}, {"rejected submission", "rejectSubmission", "Unknown"}, {"wrong project", "wrongProject", "Unknown"}, {"monitoring failure", "showFails", "Unknown"}} {
		t.Run(test.name, func(t *testing.T) {
			f := fixture(t)
			if test.marker != "" {
				f.marker(t, test.marker)
			}
			job := object(invoke(t, f.e, "scan:run", f.input()))
			actual := settled(t, f, str(job, "id"))
			if str(actual, "status") != test.want {
				t.Fatalf("Expected %s, got %s", test.want, str(actual, "status"))
			}
		})
	}
}
func TestUncertainCancellationNeverResubmits(t *testing.T) {
	f := fixture(t)
	f.marker(t, "holdSubmission")
	job := object(invoke(t, f.e, "scan:run", f.input()))
	awaitMarker(t, f, "submissionStarted")
	invoke(t, f.e, "scan:cancel-job", job)
	actual := settled(t, f, str(job, "id"))
	if str(actual, "status") != "Unknown" || str(actual, "scanId") != "" {
		t.Fatal("Uncertain submission was reported as canceled")
	}
	invokeError(t, f.e, "job:reconcile", job["id"])
	counter, _ := os.ReadFile(filepath.Join(f.root, "counter"))
	if string(counter) != "1" {
		t.Fatal("Uncertain submission was retried")
	}
}
func TestKnownCancellationOutcomes(t *testing.T) {
	for _, test := range []struct{ name, marker, want string }{{"confirmed", "", "Canceled"}, {"rejected", "cancelFails", "Unknown"}, {"pending", "cancelUnconfirmed", "Running"}} {
		t.Run(test.name, func(t *testing.T) {
			f := fixture(t)
			f.marker(t, "running")
			if test.marker != "" {
				f.marker(t, test.marker)
			}
			job := object(invoke(t, f.e, "scan:run", f.input()))
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				c, _ := f.e.client()
				saved, _ := f.e.store.get("job", c.connection, str(job, "id"))
				if str(saved, "scanId") != "" {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			invoke(t, f.e, "scan:cancel-job", job)
			if str(settled(t, f, str(job, "id")), "status") != test.want {
				t.Fatal("Remote cancellation outcome was misreported")
			}
		})
	}
}
func TestMalformedReports(t *testing.T) {
	for _, marker := range []string{"missingReport", "wrongReport", "malformedReport", "oversizedReport", "wrongScan", "missingResults"} {
		t.Run(marker, func(t *testing.T) {
			f := fixture(t)
			f.marker(t, marker)
			invokeError(t, f.e, "results:get", "s1")
			c, _ := f.e.client()
			cached, err := f.e.store.get("snapshot", c.connection, "s1")
			if err != nil || cached != nil {
				t.Fatal("Failed import was cached")
			}
		})
	}
	t.Run("partial report", func(t *testing.T) {
		f := fixture(t)
		f.marker(t, "partialReport")
		page := object(invoke(t, f.e, "results:get", "s1"))
		if !boolean(page["truncated"]) {
			t.Fatal("Incomplete report was not marked truncated")
		}
	})
	t.Run("explicit empty slice", func(t *testing.T) {
		f := fixture(t)
		f.marker(t, "nullResults")
		page := object(invoke(t, f.e, "results:get", "s1"))
		if len(array(page["findings"])) != 0 || number(page["totalCount"]) != 0 || boolean(page["truncated"]) {
			t.Fatal("Explicit empty report was rejected or changed")
		}
	})
}
func TestCapabilityAndMappingBlockBeforeUpload(t *testing.T) {
	for _, kind := range []string{"obsolete", "wrong mapping", "new project collision", "invalid options"} {
		t.Run(kind, func(t *testing.T) {
			f := fixture(t)
			input := f.input()
			switch kind {
			case "obsolete":
				f.marker(t, "obsolete")
			case "wrong mapping":
				input["projectId"] = "p2"
			case "new project collision":
				delete(input, "projectId")
			case "invalid options":
				object(input["options"])["scanners"] = []string{"unsupported"}
			}
			if kind == "new project collision" {
				job := object(invoke(t, f.e, "scan:run", input))
				if str(settled(t, f, str(job, "id")), "status") != "Failed" {
					t.Fatal("Project collision was not rejected")
				}
			} else {
				invokeError(t, f.e, "scan:run", input)
			}
			if _, err := os.Stat(filepath.Join(f.root, "submissionStarted")); err == nil {
				t.Fatal("Preflight failure uploaded source")
			}
		})
	}
}
func TestRestartRecoveryUsesKnownIDsOnly(t *testing.T) {
	f := fixture(t)
	c, _ := f.e.client()
	for _, id := range []string{"known", "uncertain"} {
		job := Object{"id": id, "connectionId": c.connection, "projectId": "p1", "projectName": "synthetic-fixture", "folderPath": f.source, "status": "Running", "progress": Object{"phase": "running"}, "startedAt": now()}
		if id == "known" {
			job["scanId"] = "s1"
		}
		if err := f.e.store.saveJob(job); err != nil {
			t.Fatal("Recovery fixture failed")
		}
	}
	f.e.Close()
	e, err := Open(f.profile, f.e.host)
	if err != nil {
		t.Fatal("Recovery open failed")
	}
	defer e.Close()
	e.Recover()
	f.e = e
	known := settled(t, f, "known")
	if str(known, "status") != "Completed" {
		t.Fatal("Known scan was not reconciled")
	}
	unknown, err := e.store.get("job", c.connection, "uncertain")
	if err != nil || str(unknown, "status") != "Unknown" {
		t.Fatal("Uncertain job was lost")
	}
	if _, err = os.Stat(filepath.Join(f.root, "submissionStarted")); err == nil {
		t.Fatal("Recovery resubmitted source")
	}
}
func TestReportCancellationSharedReaders(t *testing.T) {
	f := fixture(t)
	f.marker(t, "holdReport")
	done := make(chan error, 2)
	for _, request := range []string{"reader-a", "reader-b"} {
		go func(id string) {
			_, err := f.e.results(context.Background(), "s1", Object{"requestId": id})
			done <- err
		}(request)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		f.e.mu.Lock()
		readers := len(f.e.requests)
		f.e.mu.Unlock()
		if readers == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	f.e.cancelImport("reader-a")
	_ = os.Remove(filepath.Join(f.root, "holdReport"))
	for range 2 {
		select {
		case err := <-done:
			if err != nil {
				t.Fatal("Canceling one reader canceled the shared report")
			}
		case <-time.After(10 * time.Second):
			t.Fatal("Shared import did not finish")
		}
	}
}

func TestBatchPerPackageOptionsAndQueuedCancellation(t *testing.T) {
	f := fixture(t)
	items := []Object{}
	for i, name := range []string{"first", "second", "third"} {
		folder := filepath.Join(f.source, name)
		_ = os.MkdirAll(folder, 0700)
		_ = os.WriteFile(filepath.Join(folder, "index.js"), []byte("synthetic"), 0600)
		_, _ = f.e.grant(folder)
		connection, _ := f.e.connection(false)
		_ = f.e.store.save(record{kind: "binding", scope: connection, id: strings.ToLower(folder), value: Object{"folderPath": folder, "projectId": "p1", "projectName": "synthetic-fixture", "connectionId": connection}})
		options := clone(object(f.input()["options"]))
		options["sastPreset"] = name
		options["branch"] = name
		items = append(items, Object{"folderPath": folder, "projectName": "synthetic-fixture", "projectId": "p1", "options": options})
		_ = i
	}
	f.marker(t, "holdSubmission")
	jobs := objects(invoke(t, f.e, "scan:run-batch", Object{"items": items, "options": f.input()["options"], "concurrency": 1}))
	if len(jobs) != 3 {
		t.Fatal("Batch jobs were lost")
	}
	awaitMarker(t, f, "submissionStarted")
	invoke(t, f.e, "scan:cancel-job", jobs[2])
	invokeError(t, f.e, "scan:run-batch", Object{"items": items, "options": f.input()["options"], "concurrency": 1})
	_ = os.Remove(filepath.Join(f.root, "holdSubmission"))
	for i, job := range jobs {
		result := settled(t, f, str(job, "id"))
		if i == 2 {
			if str(result, "status") != "Canceled" {
				t.Fatal("Queued batch cancellation did not prevent upload")
			}
		} else if str(result, "status") != "Completed" {
			t.Fatal("Batch job did not complete")
		}
		if str(object(result["options"]), "sastPreset") != []string{"first", "second", "third"}[i] {
			t.Fatal("Per-package options were replaced")
		}
	}
	counter, _ := os.ReadFile(filepath.Join(f.root, "counter"))
	if string(counter) != "2" {
		t.Fatal("Canceled queued job uploaded source")
	}
}
func TestBatchRejectsDuplicateFoldersBeforeUpload(t *testing.T) {
	f := fixture(t)
	invokeError(t, f.e, "scan:run-batch", Object{"items": []Object{f.input(), f.input()}, "options": f.input()["options"], "concurrency": 2})
	if _, err := os.Stat(filepath.Join(f.root, "submissionStarted")); err == nil {
		t.Fatal("Invalid batch uploaded source")
	}
}
func TestVerificationScanPinnedOptionsAndDurability(t *testing.T) {
	f := fixture(t)
	job := object(invoke(t, f.e, "scan:run", f.input()))
	settled(t, f, str(job, "id"))
	s := object(invoke(t, f.e, "session:create", Object{"title": "Synthetic verification", "scanId": "s1", "findingIds": []string{"finding-1"}, "folderPath": f.source}))
	verification := object(invoke(t, f.e, "session:run-verification", s["id"]))
	saved, err := f.e.session(str(s, "id"))
	if err != nil || saved["verificationJobId"] != verification["id"] || str(saved, "status") != "awaiting_verification" {
		t.Fatal("Verification job and session were not durably linked")
	}
	if str(object(verification["options"]), "branch") != "main" {
		t.Fatal("Verification lost recorded scan options")
	}
	settled(t, f, str(verification, "id"))
	invokeError(t, f.e, "session:verify", Object{"id": s["id"], "scanId": "s1"})
}
func TestAllReadersCancelReportAndShutdown(t *testing.T) {
	f := fixture(t)
	f.marker(t, "holdReport")
	done := make(chan error, 1)
	go func() {
		_, err := f.e.results(context.Background(), "s1", Object{"requestId": "cancel-me"})
		done <- err
	}()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		f.e.mu.Lock()
		registered := f.e.requests["cancel-me"] != nil
		f.e.mu.Unlock()
		if registered {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	f.e.cancelImport("cancel-me")
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Canceled report unexpectedly completed")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Canceled report did not terminate")
	}
	f.e.Close()
	invokeError(t, f.e, "settings:get")
}

func TestCLIControlCapacityAndOutputLimits(t *testing.T) {
	f := fixture(t)
	c, err := f.e.client()
	if err != nil {
		t.Fatal("CLI fixture failed")
	}
	for range cap(f.e.capacity) {
		f.e.capacity <- struct{}{}
	}
	defer func() {
		for range cap(f.e.capacity) {
			<-f.e.capacity
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, err = c.command(ctx, []string{"scan", "cancel", "--scan-id=s1"}, time.Second, nil, false); err != nil {
		t.Fatal("Cancellation could not use reserved control capacity")
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel2()
	if _, err = c.command(ctx2, []string{"version"}, time.Second, nil, false); err == nil {
		t.Fatal("Ordinary command bypassed full capacity")
	}
	for range cap(f.e.queue) {
		f.e.queue <- struct{}{}
	}
	if _, err = c.command(context.Background(), []string{"version"}, time.Second, nil, false); err == nil {
		t.Fatal("CLI queue exceeded its bound")
	}
	for range cap(f.e.queue) {
		<-f.e.queue
	}
	boundedCtx, boundedCancel := context.WithCancel(context.Background())
	out := &boundedOutput{limit: 16, cancel: boundedCancel}
	if _, err = out.Write([]byte(strings.Repeat("x", 17))); err == nil || boundedCtx.Err() == nil {
		t.Fatal("Output limit did not stop the process")
	}
}
func TestCanceledImportCanBeRetriedImmediately(t *testing.T) {
	f := fixture(t)
	f.marker(t, "holdReport")
	done := make(chan error, 1)
	go func() { _, err := f.e.results(context.Background(), "s1", Object{"requestId": "first"}); done <- err }()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		f.e.mu.Lock()
		ready := f.e.requests["first"] != nil
		f.e.mu.Unlock()
		if ready {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	f.e.cancelImport("first")
	_ = os.Remove(filepath.Join(f.root, "holdReport"))
	if _, err := f.e.results(context.Background(), "s1", Object{"requestId": "second"}); err != nil {
		t.Fatal("A new reader attached to a canceled import")
	}
	<-done
}

func TestCLIProgressStreamsWithoutContaminatingJSON(t *testing.T) {
	f := fixture(t)
	c, err := f.e.client()
	if err != nil {
		t.Fatal("CLI fixture unavailable")
	}
	var mu sync.Mutex
	lines := []string{}
	output, err := c.command(context.Background(), []string{"scan", "create", "--file-source=" + f.source}, time.Second, func(line string) { mu.Lock(); lines = append(lines, line); mu.Unlock() }, false)
	if err != nil {
		t.Fatal("Synthetic CLI failed")
	}
	if _, err = parseJSON(output); err != nil {
		t.Fatal("Stderr contaminated structured CLI output")
	}
	if !contains(lines, "CLI preparing synthetic source") {
		t.Fatal("Stderr progress was not delivered")
	}
}

func TestNotificationFailureDoesNotChangeScanOutcome(t *testing.T) {
	f := fixture(t)
	original := f.e.host.Native
	f.e.host.Native = func(name string, p Object) (any, error) {
		if name == "notification" {
			return nil, errors.New("Synthetic notification refusal")
		}
		return original(name, p)
	}
	job := object(invoke(t, f.e, "scan:run", f.input()))
	saved := settled(t, f, str(job, "id"))
	if str(saved, "status") != "Completed" {
		t.Fatal("Notification failure changed the remote scan outcome")
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		logs, err := f.e.store.logs(str(job, "id"))
		if err != nil {
			t.Fatal("Notification failure log could not be read")
		}
		for _, line := range logs {
			if strings.Contains(line, "Desktop notification unavailable: Synthetic notification refusal") {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("Notification failure was silently discarded")
}
