package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestRendererCannotAuthorizeArbitraryFolders(t *testing.T) {
	f := fixture(t)
	folder := filepath.Join(f.root, "unselected")
	if err := os.Mkdir(folder, 0700); err != nil {
		t.Fatal(err)
	}
	invokeError(t, f.e, "fs:authorize-folder", folder)
	invoke(t, f.e, "settings:save", Object{"recentFolders": []string{folder}})
	for _, saved := range stringsOf(f.e.getSettings()["recentFolders"]) {
		if saved == folder {
			t.Fatal("Renderer persisted an unauthorized source grant")
		}
	}
	invokeError(t, f.e, "git:info", folder)
	canonical, err := f.e.AuthorizeFolder(folder)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.e.requireFolder(canonical); err != nil {
		t.Fatal("Native folder drop could not authorize the selected folder")
	}
}

func TestDesktopOperationMemoryAdmissionIsBounded(t *testing.T) {
	f := fixture(t)
	raw := []json.RawMessage{bytes.Repeat([]byte(" "), (32<<20)+1), bytes.Repeat([]byte(" "), 32<<20)}
	if _, err := f.e.Invoke("settings:get", raw); err == nil || !strings.Contains(err.Error(), "combined") {
		t.Fatal("Combined argument limit was not applied before decoding")
	}
	f.e.mu.Lock()
	f.e.pendingBytes = 128 << 20
	f.e.mu.Unlock()
	if _, err := f.e.Invoke("settings:get", []json.RawMessage{json.RawMessage(`"x"`)}); err == nil {
		t.Fatal("Aggregate admission limit was ignored")
	}
	f.e.mu.Lock()
	f.e.pendingBytes = 0
	f.e.mu.Unlock()
	invoke(t, f.e, "settings:get")
	if f.e.pendingBytes != 0 || f.e.pending != 0 {
		t.Fatal("Operation admission accounting leaked")
	}
}

func TestOversizedSettingsPreserveReadableConfiguration(t *testing.T) {
	f := fixture(t)
	before, err := os.ReadFile(filepath.Join(f.profile, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.e.saveSettings(Object{"defaults": Object{"extraExcludes": strings.Repeat("x", 1<<20)}}); err == nil {
		t.Fatal("Unreadable oversized settings were persisted")
	}
	after, _ := os.ReadFile(filepath.Join(f.profile, "settings.json"))
	if !bytes.Equal(before, after) {
		t.Fatal("Rejected settings modified the saved configuration")
	}
}

func TestLongCLIOutputDoesNotExposePartialSecrets(t *testing.T) {
	var lines []string
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c := &CLI{secrets: []string{"disposable-secret"}}
	output := &boundedOutput{limit: 1 << 20, cancel: cancel, redact: c.redact, line: func(s string) { lines = append(lines, s) }}
	chunks := []string{strings.Repeat("x", 16380) + "disposable-", "secret\nstill safe\n"}
	for _, chunk := range chunks {
		if _, err := output.Write([]byte(chunk)); err != nil {
			t.Fatal(err)
		}
	}
	if ctx.Err() != nil || len(lines) != 2 || lines[0] != "[Oversized CLI log line omitted]" || lines[1] != "still safe" {
		t.Fatal("Oversized log lines were partially exposed or swallowed following progress")
	}
	if output.data.String() != strings.Join(chunks, "") {
		t.Fatal("Raw CLI response parsing lost bytes")
	}
}

func TestOverlappingEnvironmentSecretsRedactLongestFirst(t *testing.T) {
	f := fixture(t)
	t.Setenv("MARX_TEST_TOKEN_SHORT", "synthetic-prefix")
	t.Setenv("MARX_TEST_TOKEN_LONG", "synthetic-prefix-private-tail")
	c, err := f.e.client()
	if err != nil {
		t.Fatal(err)
	}
	if got := c.redact("synthetic-prefix-private-tail"); got != "[redacted]" {
		t.Fatal("Overlapping secrets exposed a credential suffix")
	}
}

func TestAuthorizationHeadersNeverExposeCredentialSuffixes(t *testing.T) {
	c := &CLI{}
	for _, line := range []string{
		"Authorization: Bearer synthetic-opaque-credential",
		"Authorization: Basic synthetic-opaque-credential",
		"Authorization Bearer synthetic-opaque-credential",
		"Proxy-Authorization: Negotiate synthetic-opaque-credential",
		`{"authorization":"Bearer synthetic-opaque-credential"}`,
		"map[Authorization:[Bearer synthetic-opaque-credential]]",
		`Authorization: Digest username="test", response="synthetic-opaque-credential"`,
	} {
		got := c.redact("request failed\n" + line + "\nretry disabled")
		if strings.Contains(got, "synthetic-opaque-credential") || !strings.Contains(got, "[redacted]") {
			t.Fatal("An authorization credential survived redaction")
		}
		if !strings.HasPrefix(got, "request failed\n") || !strings.HasSuffix(got, "\nretry disabled") {
			t.Fatal("Authorization redaction changed unrelated log lines")
		}
		if c.redact(got) != got {
			t.Fatal("Repeated log redaction changed the sanitized header")
		}
	}
}

func TestWorkspaceSaveRejectsStaleConnection(t *testing.T) {
	f := fixture(t)
	connection, err := f.e.connection(true)
	if err != nil {
		t.Fatal(err)
	}
	invoke(t, f.e, "workspace:save", "results", Object{"connectionId": connection, "search": "current"})
	invokeError(t, f.e, "workspace:save", "results", Object{"connectionId": "previous-connection", "search": "stale"})
	saved := object(invoke(t, f.e, "workspace:get", "results"))
	if str(saved, "search") != "current" || str(saved, "connectionId") != connection {
		t.Fatal("Stale workspace data replaced the current connection state")
	}
	invoke(t, f.e, "workspace:save", "legacy", Object{"search": "compatible"})
	if str(object(invoke(t, f.e, "workspace:get", "legacy")), "search") != "compatible" {
		t.Fatal("A legacy workspace without a connection ID was rejected")
	}
}

func TestFindingsQueryKeepsCountsAndPageBoundaries(t *testing.T) {
	f := fixture(t)
	invoke(t, f.e, "results:get", "large-paging")
	c, err := f.e.client()
	if err != nil {
		t.Fatal(err)
	}
	first, err := f.e.store.query(c.connection, "large-paging", Object{"limit": 2})
	if err != nil {
		t.Fatal(err)
	}
	second, err := f.e.store.query(c.connection, "large-paging", Object{"offset": 2, "limit": 2})
	if err != nil {
		t.Fatal(err)
	}
	if number(first["filteredCount"]) != 5051 || len(objects(second["findings"])) != 2 || str(objects(first["findings"])[0], "id") == str(objects(second["findings"])[0], "id") {
		t.Fatal("Paged query changed totals or repeated findings")
	}
	none, err := f.e.store.query(c.connection, "large-paging", Object{"offset": 10000, "limit": 2})
	if err != nil || len(objects(none["findings"])) != 0 {
		t.Fatal("Out-of-range page did not remain empty")
	}
	searched, err := f.e.store.query(c.connection, "large-paging", Object{"search": "index.js", "limit": 2})
	if err != nil || number(searched["filteredCount"]) != 5051 {
		t.Fatal("Flow-path search lost findings")
	}
}

func TestWorkbenchDatabaseHasPrivatePermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows uses the profile ACL")
	}
	root := t.TempDir()
	file := filepath.Join(root, "private.sqlite")
	store, err := OpenStore(file)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for _, name := range []string{file, file + "-wal", file + "-shm"} {
		info, err := os.Stat(name)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm()&0077 != 0 {
			t.Fatal("Workbench evidence is readable outside the current account")
		}
	}
	link := filepath.Join(root, "alias.sqlite")
	if err = os.Symlink(file, link); err != nil {
		t.Fatal(err)
	}
	if aliased, err := OpenStore(link); err == nil {
		aliased.Close()
		t.Fatal("A database symlink was followed")
	}
}
