package engine

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func comparisonPage(id string, findings []Object) Object {
	date := "2026-01-01T00:00:00Z"
	if id == "after" {
		date = "2026-01-02T00:00:00Z"
	}
	for _, f := range findings {
		f["scanId"] = id
		f["projectId"] = "p"
	}
	return Object{"connectionId": "tenant", "scan": Object{"id": id, "projectId": "p", "branch": "main", "status": "Completed", "createdAt": date}, "provenance": Object{"version": 1, "connectionId": "tenant", "optionsFingerprint": "request", "requestedScanners": []string{"sast"}, "completedScanners": []string{"sast"}, "effectiveConfigFingerprint": "server-config", "source": Object{"folderPath": "synthetic-repo", "branch": "main", "snapshot": true, "fingerprint": "source"}, "options": Object{"scanners": []string{"sast"}, "branch": "main", "sastPreset": "Default", "sastIncremental": false, "scaExploitablePath": false, "excludes": []string{"node_modules"}}}, "findings": findings, "totalCount": len(findings), "truncated": false}
}
func comparisonFinding(id, severity string) Object {
	return Object{"id": id, "type": "sast", "similarityId": id, "severity": severity, "flow": []Object{}}
}
func TestComparisonCoverageRules(t *testing.T) {
	for _, test := range []struct {
		name                   string
		modify                 func(Object, Object)
		compatibility, verdict string
	}{
		{"full coverage", func(b, c Object) {}, "comparable", "pass"},
		{"missing provenance", func(b, c Object) { delete(c, "provenance") }, "inconclusive", "inconclusive"},
		{"unverified effective configuration", func(b, c Object) { delete(object(c["provenance"]), "effectiveConfigFingerprint") }, "inconclusive", "inconclusive"},
		{"unverified engine coverage", func(b, c Object) { delete(object(c["provenance"]), "completedScanners") }, "inconclusive", "inconclusive"},
		{"live source", func(b, c Object) { object(object(c["provenance"])["source"])["snapshot"] = false }, "inconclusive", "inconclusive"},
		{"source changed", func(b, c Object) { object(c["provenance"])["sourceChanged"] = true }, "inconclusive", "inconclusive"},
		{"different source", func(b, c Object) { object(object(c["provenance"])["source"])["folderPath"] = "other" }, "inconclusive", "inconclusive"},
		{"different tenant", func(b, c Object) { c["connectionId"] = "other" }, "incompatible", "inconclusive"},
		{"different project", func(b, c Object) { object(c["scan"])["projectId"] = "other" }, "incompatible", "inconclusive"},
		{"different preset", func(b, c Object) { object(object(c["provenance"])["options"])["sastPreset"] = "other" }, "incompatible", "inconclusive"},
		{"different effective configuration", func(b, c Object) { object(c["provenance"])["effectiveConfigFingerprint"] = "other" }, "incompatible", "inconclusive"},
		{"different completed engines", func(b, c Object) { object(c["provenance"])["completedScanners"] = []string{"sca"} }, "incompatible", "inconclusive"},
		{"wrong provenance connection", func(b, c Object) { object(c["provenance"])["connectionId"] = "other" }, "incompatible", "inconclusive"},
		{"wrong provenance branch", func(b, c Object) { object(object(c["provenance"])["source"])["branch"] = "other" }, "incompatible", "inconclusive"},
		{"partial status", func(b, c Object) { object(c["scan"])["status"] = "Partial" }, "inconclusive", "inconclusive"},
		{"truncated report", func(b, c Object) { c["truncated"] = true }, "inconclusive", "inconclusive"},
		{"reversed dates", func(b, c Object) { object(c["scan"])["createdAt"] = "2025-01-01T00:00:00Z" }, "incompatible", "inconclusive"},
		{"missing dates", func(b, c Object) { delete(object(c["scan"]), "createdAt") }, "inconclusive", "inconclusive"},
	} {
		t.Run(test.name, func(t *testing.T) {
			b, c := comparisonPage("before", []Object{}), comparisonPage("after", []Object{})
			test.modify(b, c)
			r := compareScans(b, c)
			if str(r, "compatibility") != test.compatibility || str(r, "verdict") != test.verdict {
				t.Fatalf("Expected %s/%s, got %s/%s", test.compatibility, test.verdict, str(r, "compatibility"), str(r, "verdict"))
			}
		})
	}
}
func TestComparisonOccurrenceIdentity(t *testing.T) {
	t.Run("severity changes and stable identities", func(t *testing.T) {
		old := comparisonFinding("old", "MEDIUM")
		old["similarityId"] = "stable"
		current := comparisonFinding("new", "HIGH")
		current["similarityId"] = "stable"
		r := compareScans(comparisonPage("before", []Object{old}), comparisonPage("after", []Object{current}))
		if object(r["changes"])["new"] != "ESCALATED" || str(r, "verdict") != "attention" {
			t.Fatal("Stable identity escalation was lost")
		}
	})
	for _, kind := range []string{"missing stable identity", "duplicate family", "ambiguous occurrence", "wrong finding scope", "duplicate result IDs", "unknown severity", "partial baseline"} {
		t.Run(kind, func(t *testing.T) {
			f := comparisonFinding("f", "HIGH")
			b, c := comparisonPage("before", []Object{comparisonFinding("old", "LOW")}), comparisonPage("after", []Object{f})
			switch kind {
			case "missing stable identity":
				delete(f, "similarityId")
			case "duplicate family":
				other := clone(f)
				other["id"] = "second"
				c["findings"] = []Object{f, other}
				c["totalCount"] = 2
			case "ambiguous occurrence":
				f["identityAmbiguous"] = true
			case "wrong finding scope":
				f["projectId"] = "other"
			case "duplicate result IDs":
				c["findings"] = []Object{f, clone(f)}
				c["totalCount"] = 2
			case "unknown severity":
				f["severity"] = "UNKNOWN"
			case "partial baseline":
				b["truncated"] = true
			}
			r := compareScans(b, c)
			if str(r, "verdict") == "pass" {
				t.Fatal("Uncertain evidence produced a passing verdict")
			}
			if kind != "unknown severity" && object(r["changes"])["f"] != "UNCERTAIN" {
				t.Fatal("Ambiguous finding was matched")
			}
		})
	}
}
func TestSCAUpgradeDoesNotProveRemediation(t *testing.T) {
	old := comparisonFinding("old", "HIGH")
	old["type"] = "sca"
	old["packageManager"] = "Npm"
	old["packageName"] = "synthetic-package"
	old["packageVersion"] = "1"
	old["cve"] = "CVE-SYNTHETIC"
	latest := clone(old)
	latest["id"] = "new"
	latest["packageVersion"] = "2"
	b, c := comparisonPage("before", []Object{old}), comparisonPage("after", []Object{latest})
	r := compareScans(b, c)
	remaining, absent := verifySelected(b, c, []string{"old"}, r)
	if len(remaining) != 1 || len(absent) != 0 {
		t.Fatal("Vulnerable package version change claimed remediation")
	}
}
func TestNormalizationPreservesAllOccurrences(t *testing.T) {
	raw := []any{}
	for _, scanner := range []string{"sast", "sca", "kics", "vendor-extension"} {
		raw = append(raw, Object{"id": "duplicate", "type": scanner, "severity": "unexpected", "descriptionHTML": "<p>Synthetic &amp; evidence</p>", "data": Object{"queryName": "Synthetic", "nodes": []Object{{"fileName": "a.js", "line": 2}}, "packageIdentifier": "Npm-synthetic-1", "scaPackageData": Object{"locations": []string{"package-lock.json"}, "dependencyPaths": []any{[]Object{{"id": "Npm-synthetic-1", "name": "synthetic", "version": "1"}}}}}})
	}
	raw = append(raw, clone(object(raw[0])))
	out, err := normalizeFindings(raw, "scan", "project", "connection")
	if err != nil || len(out) != 5 {
		t.Fatal("Normalization dropped occurrences")
	}
	seen := map[string]bool{}
	ambiguous := 0
	for _, f := range out {
		if seen[str(f, "id")] {
			t.Fatal("Occurrence identities collide")
		}
		seen[str(f, "id")] = true
		if str(f, "severity") != "UNKNOWN" || str(f, "description") != "Synthetic & evidence" {
			t.Fatal("Normalization lost evidence")
		}
		if boolean(f["identityAmbiguous"]) {
			ambiguous++
		}
		if str(f, "type") == "sca" && (str(f, "packageName") != "synthetic" || str(f, "packageVersion") != "1" || str(f, "packageManager") != "Npm" || str(f, "where") != "package-lock.json") {
			t.Fatal("SCA metadata was lost")
		}
	}
	if ambiguous != 2 {
		t.Fatal("Ambiguous vendor duplicates were not marked")
	}
}
func TestSourceContainmentAndWindowsPaths(t *testing.T) {
	f := fixture(t)
	for _, path := range []string{"index.js", "./index.js", "sub/../index.js", "sub\\..\\index.js"} {
		t.Run(path, func(t *testing.T) {
			if _, err := readSnippet(f.source, path, 1); err != nil {
				t.Fatal("Contained mixed-separator source failed")
			}
		})
	}
	outside := filepath.Join(f.root, "outside.js")
	_ = os.WriteFile(outside, []byte("private synthetic"), 0600)
	for _, path := range []string{"..\\outside.js", "../outside.js", outside, "C:outside.js", "\\\\server\\share\\outside.js"} {
		if _, err := readSnippet(f.source, path, 1); err == nil {
			t.Fatal("Outside source path was accepted")
		}
	}
	if err := os.Symlink(outside, filepath.Join(f.source, "link.js")); err == nil {
		if _, err = readSnippet(f.source, "link.js", 1); err == nil {
			t.Fatal("Symlink escaped containment")
		}
	}
	invokeError(t, f.e, "fs:read-source-file", f.source, "index.js", 1, "p2")
	snippet := object(invoke(t, f.e, "fs:read-source-file", f.source, "index.js", 1, "p1"))
	if number(snippet["totalLines"]) != 3 {
		t.Fatal("Source snippet is incorrect")
	}
	unauthorized := filepath.Join(f.root, "unselected")
	_ = os.Mkdir(unauthorized, 0700)
	invokeError(t, f.e, "git:info", unauthorized)
}
func TestProvenanceTracksContentAndOptions(t *testing.T) {
	f := fixture(t)
	options := object(f.input()["options"])
	first := captureProvenance(context.Background(), f.source, options, "connection", "synthetic")
	fingerprint := str(object(first["source"]), "fingerprint")
	if fingerprint == "" {
		t.Fatal("Source fingerprint unavailable")
	}
	_ = os.WriteFile(filepath.Join(f.source, "index.js"), []byte("changed"), 0600)
	second := captureProvenance(context.Background(), f.source, options, "connection", "synthetic")
	if str(object(second["source"]), "fingerprint") == fingerprint {
		t.Fatal("Source change was missed")
	}
	if str(first, "optionsFingerprint") != str(second, "optionsFingerprint") {
		t.Fatal("Source content changed the options fingerprint")
	}
	options["sastPreset"] = "other"
	third := captureProvenance(context.Background(), f.source, options, "connection", "synthetic")
	if str(first, "optionsFingerprint") == str(third, "optionsFingerprint") {
		t.Fatal("Options change was missed")
	}
	if boolean(object(first["source"])["snapshot"]) {
		t.Fatal("Live source was misrepresented as an archive")
	}
}
func TestConfigurationIdentityAndCredentialBoundaries(t *testing.T) {
	f := fixture(t)
	config := filepath.Join(f.root, "config.yaml")
	_ = os.WriteFile(config, []byte("tenant: synthetic-one"), 0600)
	invoke(t, f.e, "settings:save", Object{"cliConfigPath": config})
	a, err := f.e.client()
	if err != nil {
		t.Fatal("CLI configuration failed")
	}
	_ = os.WriteFile(config, []byte("tenant: synthetic-two"), 0600)
	b, err := f.e.client()
	if err != nil || a.connection == b.connection {
		t.Fatal("Configuration bytes did not scope connection identity")
	}
	invoke(t, f.e, "settings:set-api-key", "disposable-only")
	invoke(t, f.e, "settings:save", Object{"cliAuthMode": "marx"})
	c, err := f.e.client()
	if err != nil {
		t.Fatal("Credential configuration failed")
	}
	if c.redact("Bearer disposable-only apiKey=other") == "Bearer disposable-only apiKey=other" {
		t.Fatal("Credential redaction failed")
	}
	for _, value := range []string{c.connection, string(jsonValue(f.e.getSettings()))} {
		if strings.Contains(value, "disposable-only") {
			t.Fatal("Credential escaped into public settings or identity")
		}
	}
	_ = os.WriteFile(filepath.Join(f.root, "expectedKey"), []byte("disposable-only"), 0600)
	invoke(t, f.e, "settings:test-connection")
	invoke(t, f.e, "settings:set-api-key", "")
	if boolean(f.e.getSettings()["hasApiKey"]) {
		t.Fatal("Credential deletion failed")
	}
	invokeError(t, f.e, "settings:test-connection")
}
func TestDurableStoreRejectsCorruptionAndFutureSchemas(t *testing.T) {
	for _, kind := range []string{"corrupt", "future"} {
		t.Run(kind, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "workbench.sqlite")
			if kind == "corrupt" {
				_ = os.WriteFile(file, []byte("not sqlite"), 0600)
			} else {
				s, err := OpenStore(file)
				if err != nil {
					t.Fatal("Store fixture failed")
				}
				_, _ = s.db.Exec("PRAGMA user_version=999")
				s.Close()
			}
			before, _ := os.ReadFile(file)
			if s, err := OpenStore(file); err == nil {
				s.Close()
				t.Fatal("Unreadable or newer database was opened")
			}
			after, _ := os.ReadFile(file)
			if string(before) != string(after) {
				t.Fatal("Rejected database was changed")
			}
		})
	}
}
func TestExportsAndNativeOperations(t *testing.T) {
	f := fixture(t)
	findings := []Object{{"id": "f", "title": "  =SYNTHETIC()", "description": "Evidence, with quotes \" and newline\n", "severity": "HIGH"}}
	for _, format := range []string{"csv", "json"} {
		target := text(invoke(t, f.e, "results:export", Object{"format": format, "label": "CON / [synthetic]", "findings": findings}))
		if !within(f.downloads, target) {
			t.Fatal("Export escaped Downloads")
		}
		data, err := os.ReadFile(target)
		if err != nil || len(data) == 0 {
			t.Fatal("Export file is missing")
		}
		if format == "json" {
			var content any
			if json.Unmarshal(data, &content) != nil {
				t.Fatal("JSON export is invalid")
			}
		}
	}
	for _, ch := range []string{"results:sarif", "remediation:save"} {
		var value any
		if ch == "results:sarif" {
			value = invoke(t, f.e, ch, "s1")
		} else {
			value = invoke(t, f.e, ch, Object{"text": "Synthetic prompt", "suggestedName": "synthetic"})
		}
		if _, err := os.Stat(text(value)); err != nil {
			t.Fatal("Native save export failed")
		}
	}
	invokeError(t, f.e, "remediation:copy", "")
	invokeError(t, f.e, "remediation:copy", strings.Repeat("x", 8<<20+1))
	invokeError(t, f.e, "shell:open-external", "file:///private")
	invokeError(t, f.e, "$shutdown")
	invokeError(t, f.e, "session:update", Object{"id": "missing", "status": "verified"})
}
func TestRetentionProtectsUncertainJobsAndPinnedEvidence(t *testing.T) {
	f := fixture(t)
	connection, _ := f.e.connection(false)
	old := now() - 90*86400000
	for _, status := range []string{"Unknown", "Completed"} {
		job := Object{"id": status, "connectionId": connection, "status": status, "finishedAt": old, "scanId": status}
		if err := f.e.store.saveJob(job); err != nil {
			t.Fatal("Retention fixture failed")
		}
	}
	if err := f.e.prune(30); err != nil {
		t.Fatal("Retention failed")
	}
	unknown, _ := f.e.store.get("job", connection, "Unknown")
	completed, _ := f.e.store.get("job", connection, "Completed")
	if unknown == nil || completed != nil {
		t.Fatal("Retention removed uncertain work or retained old finished work")
	}
}
func TestWorkspaceDiscoveryNestedPatternsAndImpact(t *testing.T) {
	f := fixture(t)
	root := f.source
	_ = os.WriteFile(filepath.Join(root, "package.json"), jsonValue(Object{"workspaces": []string{"packages/{apps,libs}/*", "!packages/apps/excluded"}}), 0600)
	for _, p := range []struct {
		path, name string
		deps       Object
	}{{"packages/apps/ui", "ui", Object{"core": "*"}}, {"packages/libs/core", "core", Object{}}, {"packages/apps/excluded", "excluded", Object{}}} {
		folder := filepath.Join(root, filepath.FromSlash(p.path))
		_ = os.MkdirAll(folder, 0700)
		_ = os.WriteFile(filepath.Join(folder, "package.json"), jsonValue(Object{"name": p.name, "dependencies": p.deps}), 0600)
	}
	plan, err := planWorkspace(context.Background(), root)
	if err != nil {
		t.Fatal("Workspace discovery failed")
	}
	projects := objects(plan["projects"])
	if len(projects) != 2 {
		t.Fatal("Nested workspace patterns or exclusions were lost")
	}
	foundDependency := false
	for _, p := range projects {
		if str(p, "name") == "ui" {
			foundDependency = contains(stringsOf(p["dependencies"]), "core")
		}
	}
	if !foundDependency {
		t.Fatal("Workspace dependency graph was lost")
	}
	for _, args := range [][]string{{"init"}, {"-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.test", "add", "."}, {"-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.test", "commit", "-m", "Synthetic fixture"}} {
		cmd := execGit(root, args)
		if cmd != nil {
			t.Fatal("Synthetic Git fixture failed")
		}
	}
	_ = os.WriteFile(filepath.Join(root, "packages", "libs", "core", "new.js"), []byte("synthetic"), 0600)
	plan, err = planWorkspace(context.Background(), root)
	if err != nil || !boolean(plan["impactAvailable"]) {
		t.Fatal("Git change impact unavailable")
	}
	for _, p := range objects(plan["projects"]) {
		if !boolean(p["affected"]) {
			t.Fatal("Dependency change impact was lost")
		}
	}
}
func execGit(root string, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := gitCommand(ctx, root, args...)
	return err
}
func TestWorkspacePatternBudgets(t *testing.T) {
	patterns, limited := expandBraces(strings.Repeat("{a,b,c,d,e,f,g,h,i,j}", 20))
	if !limited || len(patterns) > 100 {
		t.Fatal("Brace expansion budget failed")
	}
	for _, test := range []struct {
		pattern, path string
		want          bool
	}{{"packages/*", "packages/a", true}, {"packages/*", "packages/a/b", false}, {"packages/**", "packages/a/b", true}, {"packages/**/ui", "packages/ui", true}, {"packages/**/ui", "packages/apps/ui", true}} {
		re, err := workspaceGlob(test.pattern)
		if err != nil || re.MatchString(test.path) != test.want {
			t.Fatal("Workspace glob semantics are incorrect")
		}
	}
}
