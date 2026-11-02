package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestMixedMultilineJSON(t *testing.T) {
	for _, response := range []string{`{"ID":"s1","message":"braces } [ and escaped \" quote","nested":{"a":[1,2]}}`, `[{"ID":"s1"}]`, `[]`} {
		var pretty any
		if err := json.Unmarshal([]byte(response), &pretty); err != nil {
			t.Fatal(err)
		}
		data, _ := json.MarshalIndent(pretty, "", "  ")
		for _, input := range []string{string(data), "[INFO] Preparing scan\n" + string(data) + "\nDone", "{}\n" + string(data)} {
			got, err := parseJSON(input)
			if err != nil || string(jsonValue(got)) != string(jsonValue(pretty)) {
				t.Fatalf("parse failed: %v, %v", got, err)
			}
		}
	}
	if _, err := parseJSON("diagnostics\n{\"unfinished\":"); err == nil {
		t.Fatal("accepted incomplete response")
	}
}

func TestPlainFolderBranchFallback(t *testing.T) {
	info := gitInfo(context.Background(), t.TempDir())
	if boolean(info["hasGit"]) || str(info, "branch") != "master" {
		t.Fatalf("unexpected metadata: %v", info)
	}
}

func TestVerificationAdmissionLeavesSessionUnchanged(t *testing.T) {
	f := fixture(t)
	job := object(invoke(t, f.e, "scan:run", f.input()))
	settled(t, f, str(job, "id"))
	s := object(invoke(t, f.e, "session:create", Object{"title": "Admission", "scanId": "s1", "findingIds": []string{"finding-1"}, "folderPath": f.source}))
	before, _ := f.e.session(str(s, "id"))
	jobs, _ := f.e.store.list("job", nil)
	f.e.mu.Lock()
	for i := 0; i < 8; i++ {
		f.e.active[fmt.Sprint(i)] = &activeJob{}
	}
	f.e.mu.Unlock()
	defer func() {
		f.e.mu.Lock()
		for i := 0; i < 8; i++ {
			delete(f.e.active, fmt.Sprint(i))
		}
		f.e.mu.Unlock()
	}()
	if _, err := f.e.runVerification(context.Background(), str(s, "id")); err == nil {
		t.Fatal("admitted over capacity")
	}
	after, _ := f.e.session(str(s, "id"))
	afterJobs, _ := f.e.store.list("job", nil)
	if string(jsonValue(before)) != string(jsonValue(after)) || len(jobs) != len(afterJobs) {
		t.Fatal("rejected admission changed durable state")
	}
}

func TestJobAdmissionRollsBackRelatedRecordsOnWriteFailure(t *testing.T) {
	f := fixture(t)
	c, err := f.e.client()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.e.store.db.Exec(`CREATE TRIGGER reject_job BEFORE INSERT ON records WHEN NEW.kind='job' BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END`); err != nil {
		t.Fatal(err)
	}
	job := Object{"id": "rejected", "connectionId": c.connection}
	_, err = f.e.startJobWithRecords(job, c, false, record{kind: "session", scope: c.connection, id: "unchanged", value: Object{"status": "awaiting_verification"}})
	if err == nil {
		t.Fatal("write failure accepted")
	}
	s, err := f.e.store.get("session", c.connection, "unchanged")
	if err != nil || s != nil || len(f.e.active) != 0 {
		t.Fatal("partial admission survived rollback")
	}
}

func TestQueuedCancellationWinsAtJobAdmission(t *testing.T) {
	for _, activeCount := range []int{0, 8} {
		t.Run(fmt.Sprintf("active-%d", activeCount), func(t *testing.T) {
			f := fixture(t)
			job, c, err := f.e.prepareJob(context.Background(), f.input())
			if err != nil {
				t.Fatal(err)
			}
			job["batchId"] = "synthetic-batch"
			invoke(t, f.e, "scan:cancel-job", job)
			f.e.mu.Lock()
			for index := range activeCount {
				f.e.active[fmt.Sprint(index)] = &activeJob{cancel: func() {}}
			}
			f.e.mu.Unlock()
			result, err := f.e.startJob(job, c, false)
			if err != nil || str(result, "status") != "Canceled" || str(object(result["progress"]), "phase") != "canceled" {
				t.Fatalf("Queued cancellation was lost at admission: %v %v", result, err)
			}
			stored, err := f.e.store.get("job", c.connection, str(job, "id"))
			if err != nil || str(stored, "status") != "Canceled" || number(stored["finishedAt"]) == 0 {
				t.Fatalf("Canceled job was not durably settled: %v %v", stored, err)
			}
			f.e.mu.Lock()
			admitted := f.e.active[str(job, "id")] != nil
			f.e.mu.Unlock()
			if admitted {
				t.Fatal("Canceled job started execution")
			}
			if _, err := os.Stat(filepath.Join(f.root, "counter")); !os.IsNotExist(err) {
				t.Fatal("Canceled queued job reached source submission")
			}
		})
	}
}
