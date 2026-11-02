package engine

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestInterruptedWALPreservesCommittedEvidence(t *testing.T) {
	directory := t.TempDir()
	file := filepath.Join(directory, "original.sqlite")
	store, err := OpenStore(file)
	if err != nil {
		t.Fatal("Recovery fixture failed")
	}
	defer store.Close()
	if _, err = store.db.Exec("PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=1"); err != nil {
		t.Fatal("Recovery fixture configuration failed")
	}
	evidence := Object{"findings": []Object{{"id": "synthetic-original", "description": "Original committed evidence"}}}
	if err = store.save(record{kind: "baseline", scope: "synthetic", id: "session", value: evidence, immutable: true}); err != nil {
		t.Fatal("Committed evidence fixture failed")
	}
	tx, err := store.db.Begin()
	if err != nil {
		t.Fatal("Uncommitted transaction fixture failed")
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO records(kind,scope,id,updated,payload) VALUES(?,?,?,?,?)", "workspace", "synthetic", "uncommitted", now(), jsonValue(Object{"text": strings.Repeat("x", 4<<20)})); err != nil {
		t.Fatal("Uncommitted write fixture failed")
	}
	recoveredFile := filepath.Join(directory, "recovered.sqlite")
	for _, suffix := range []string{"", "-wal"} {
		data, err := os.ReadFile(file + suffix)
		if err != nil {
			t.Fatal("Crash snapshot could not be copied")
		}
		if err = os.WriteFile(recoveredFile+suffix, data, 0600); err != nil {
			t.Fatal("Crash snapshot could not be written")
		}
	}
	tail, err := os.OpenFile(recoveredFile+"-wal", os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal("Partial WAL tail fixture failed")
	}
	_, err = tail.Write(make([]byte, 17))
	tail.Close()
	if err != nil {
		t.Fatal("Partial WAL tail could not be written")
	}
	recovered, err := OpenStore(recoveredFile)
	if err != nil {
		t.Fatal("Committed WAL evidence could not be recovered")
	}
	defer recovered.Close()
	original, err := recovered.get("baseline", "synthetic", "session")
	if err != nil || string(jsonValue(original)) != string(jsonValue(evidence)) {
		t.Fatal("Recovery changed committed baseline evidence")
	}
	unfinished, err := recovered.get("workspace", "synthetic", "uncommitted")
	if err != nil || unfinished != nil {
		t.Fatal("Recovery accepted an uncommitted write")
	}
	var integrity string
	if err = recovered.db.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		t.Fatal("Recovered database failed integrity validation")
	}
}

func TestSQLiteFullRollsBackEvidenceTransaction(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "bounded.sqlite"))
	if err != nil {
		t.Fatal("Database-full fixture failed")
	}
	defer store.Close()
	original := Object{"notes": "Original committed notes"}
	baseline := Object{"findings": []string{"original-evidence"}}
	if err = store.save(record{kind: "session", scope: "synthetic", id: "session", value: original}, record{kind: "baseline", scope: "synthetic", id: "session", value: baseline, immutable: true}); err != nil {
		t.Fatal("Original evidence fixture failed")
	}
	var pages int
	if err = store.db.QueryRow("PRAGMA page_count").Scan(&pages); err != nil {
		t.Fatal("Database limit fixture failed")
	}
	if _, err = store.db.Exec("PRAGMA max_page_count=" + stringValue(pages+1)); err != nil {
		t.Fatal("Database limit could not be applied")
	}
	err = store.save(record{kind: "session", scope: "synthetic", id: "session", value: Object{"notes": "Must roll back"}}, record{kind: "verification", scope: "synthetic", id: "session", value: Object{"text": strings.Repeat("x", 4<<20)}})
	var sqliteError interface{ Code() int }
	if err == nil || !errors.As(err, &sqliteError) || sqliteError.Code()&255 != 13 {
		t.Fatal("Expected a real SQLite full-database error")
	}
	saved, err := store.get("session", "synthetic", "session")
	if err != nil || string(jsonValue(saved)) != string(jsonValue(original)) {
		t.Fatal("Failed transaction changed session notes")
	}
	saved, err = store.get("baseline", "synthetic", "session")
	if err != nil || string(jsonValue(saved)) != string(jsonValue(baseline)) {
		t.Fatal("Failed transaction changed original evidence")
	}
	saved, err = store.get("verification", "synthetic", "session")
	if err != nil || saved != nil {
		t.Fatal("Failed transaction committed partial verification evidence")
	}
}

func TestWindowsReadPermissionFailureDoesNotExposeSource(t *testing.T) {
	directory := t.TempDir()
	file := filepath.Join(directory, "denied.js")
	if os.WriteFile(file, []byte("Synthetic private source"), 0600) != nil {
		t.Fatal("Permission fixture failed")
	}
	token, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal("Current test identity unavailable")
	}
	sid := "*" + token.User.Sid.String()
	if output, err := exec.Command("icacls.exe", file, "/deny", sid+":(R)").CombinedOutput(); err != nil {
		_ = output
		t.Fatal("Disposable file read restriction could not be set")
	}
	defer func() {
		if _, err := exec.Command("icacls.exe", file, "/remove:d", sid).CombinedOutput(); err != nil {
			t.Error("Disposable file read restriction could not be removed")
		}
	}()
	if _, err = readSnippet(directory, "denied.js", 1); err == nil {
		t.Fatal("Source read ignored Windows read permissions")
	}
}
