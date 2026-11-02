package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func main() {
	args := os.Args[1:]
	root := os.Getenv("MARX_FIXTURE_ROOT")
	if root == "" {
		os.Exit(3)
	}
	value := func(name string) string {
		for _, a := range args {
			if strings.HasPrefix(a, "--"+name+"=") {
				return strings.TrimPrefix(a, "--"+name+"=")
			}
		}
		return ""
	}
	exists := func(name string) bool { _, err := os.Stat(filepath.Join(root, name)); return err == nil }
	emit := func(v any) { b, _ := json.Marshal(v); fmt.Println(string(b)) }
	receipt, _ := os.OpenFile(filepath.Join(root, "receipt"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if receipt != nil {
		_ = json.NewEncoder(receipt).Encode(map[string]any{"args": args})
		receipt.Close()
	}
	if len(args) == 0 {
		os.Exit(3)
	}
	for _, a := range args {
		if a == "--help" {
			flags := []string{"debug", "retry", "config-file-path", "format", "filter", "project-id", "file-source", "project-name", "branch", "scan-types", "async", "scan-info-format", "skip-default-filter", "file-filter", "file-filter-ext", "exclude-git-folder", "sast-incremental", "sast-preset-name", "sca-exploitable-path", "base-branch", "tags", "scan-id", "report-format", "output-name", "output-path"}
			for _, flag := range flags {
				if exists("obsolete") && flag == "scan-info-format" {
					continue
				}
				fmt.Println("  --" + flag + " string Synthetic capability")
			}
			return
		}
	}
	projectName := "synthetic-fixture"
	if exists("showcase") {
		projectName = "Demo service"
	}
	project := map[string]any{"ID": "p1", "Name": projectName, "MainBranch": "main"}
	scan := func(id string) map[string]any {
		created := "2026-10-30T12:00:00Z"
		if id == "s2" {
			created = "2026-10-31T12:00:00Z"
		}
		status := "Completed"
		if exists("running") {
			status = "Running"
		}
		if exists("canceled") {
			status = "Canceled"
		}
		if exists("partial") {
			status = "Partial"
		}
		if exists("failed") {
			status = "Failed"
		}
		if exists("unknown") {
			status = "NewVendorStatus"
		}
		pid := "p1"
		if exists("wrongProject") {
			pid = "p2"
		}
		return map[string]any{"ID": id, "ProjectID": pid, "ProjectName": projectName, "Branch": "main", "Status": status, "CreatedAt": created}
	}
	switch args[0] {
	case "version":
		fmt.Println("2.3.69-synthetic")
		return
	case "auth":
		if expected, err := os.ReadFile(filepath.Join(root, "expectedKey")); err == nil && os.Getenv("CX_APIKEY") != string(expected) {
			fmt.Fprintln(os.Stderr, "Disposable credential did not reach CLI environment")
			os.Exit(1)
		}
		fmt.Println("Authenticated")
		return
	case "project":
		if len(args) > 1 && args[1] == "show" {
			emit(project)
		} else {
			emit([]any{project})
		}
		return
	case "triage":
		fmt.Println("Updated")
		return
	case "scan":
		if len(args) < 2 {
			os.Exit(3)
		}
		switch args[1] {
		case "create":
			fmt.Fprintln(os.Stderr, "CLI preparing synthetic source")
			if _, err := os.Stat(filepath.Join(value("file-source"), "index.js")); err != nil {
				os.Exit(2)
			}
			if exists("rejectSubmission") {
				fmt.Fprintln(os.Stderr, "Synthetic upload rejected")
				os.Exit(1)
			}
			data, _ := os.ReadFile(filepath.Join(root, "counter"))
			n, _ := strconv.Atoi(string(data))
			n++
			_ = os.WriteFile(filepath.Join(root, "counter"), []byte(strconv.Itoa(n)), 0600)
			_ = os.WriteFile(filepath.Join(root, "submissionStarted"), []byte("started"), 0600)
			_ = os.WriteFile(filepath.Join(root, "submissionPID"), []byte(strconv.Itoa(os.Getpid())), 0600)
			for i := 0; exists("holdSubmission") && i < 600; i++ {
				time.Sleep(50 * time.Millisecond)
			}
			id := "s" + strconv.Itoa(n)
			if exists("streamThenFail") {
				emit(scan(id))
				fmt.Fprintln(os.Stderr, "Synthetic interrupted response")
				os.Exit(1)
			}
			emit(scan(id))
			return
		case "show":
			if exists("showFails") {
				fmt.Fprintln(os.Stderr, "Synthetic remote unavailable")
				os.Exit(1)
			}
			id := value("scan-id")
			if exists("wrongScan") {
				id = "other"
			}
			emit(scan(id))
			return
		case "list":
			items := []any{scan("s1"), scan("s2"), scan("large-paging")}
			if exists("showcase") {
				items = append(items, scan("showcase"))
			}
			if exists("intel-demo") {
				items = append(items, scan("intel-demo"))
			}
			emit(items)
			return
		case "cancel":
			if exists("cancelFails") {
				fmt.Fprintln(os.Stderr, "Synthetic cancellation unavailable")
				os.Exit(1)
			}
			if !exists("cancelUnconfirmed") {
				_ = os.WriteFile(filepath.Join(root, "canceled"), []byte("yes"), 0600)
			}
			fmt.Println("Cancellation requested")
			return
		}
	case "results":
		if exists("holdReport") {
			for i := 0; exists("holdReport") && i < 600; i++ {
				time.Sleep(50 * time.Millisecond)
			}
		}
		if exists("missingReport") {
			return
		}
		id := value("scan-id")
		count := 21
		if id == "showcase" {
			count = 8
		}
		if id == "large-paging" {
			count = 5051
		}
		if id == "intel-demo" {
			count = 2
		}
		if id == "s2" {
			count = 0
		}
		if id == "s1" && exists("changedEvidence") {
			count = 20
		}
		var report any
		extension := "json"
		switch value("report-format") {
		case "sarif":
			report = map[string]any{"version": "2.1.0", "runs": []any{map[string]any{"tool": map[string]any{"driver": map[string]any{"name": "Synthetic CLI"}}, "results": []any{}}}}
			extension = "sarif"
		case "summaryJSON":
			report = map[string]any{"CriticalIssues": 0, "HighIssues": count, "MediumIssues": 0, "LowIssues": 0, "InfoIssues": 0}
			if id == "showcase" {
				report = map[string]any{"CriticalIssues": 1, "HighIssues": 2, "MediumIssues": 2, "LowIssues": 2, "InfoIssues": 1}
			}
		default:
			results := make([]any, count)
			for i := range results {
				results[i] = map[string]any{"id": fmt.Sprintf("finding-%d", i+1), "similarityId": fmt.Sprintf("stable-%d", i+1), "type": "sast", "severity": "HIGH", "state": "TO_VERIFY", "status": "NEW", "data": map[string]any{"queryName": fmt.Sprintf("Synthetic injection %d", i+1), "nodes": []any{map[string]any{"fileName": "index.js", "line": 1}}}}
			}

			if id == "showcase" {
				samples := []struct {
					title, severity, file, source, sink, description string
					line                                             int
				}{
					{"SQL injection in account search", "CRITICAL", "src/api/accounts.ts", "req.query.search", "database.query", "Synthetic example: request input is concatenated into a database query. Use a parameterized query and validate the expected input shape.", 42},
					{"Stored cross-site scripting", "HIGH", "src/components/Search.tsx", "savedSearch.description", "innerHTML", "Synthetic example: persisted search text reaches an HTML sink without context-appropriate encoding. Preserve the framework's built-in escaping.", 87},
					{"Path traversal in file download", "HIGH", "src/api/files.ts", "req.params.filename", "readFile", "Synthetic example: a caller-controlled filename reaches a filesystem read. Restrict access to the intended root and validate the resolved target.", 66},
					{"Unvalidated redirect target", "MEDIUM", "src/auth/callback.ts", "req.query.next", "response.redirect", "Synthetic example: a redirect target is accepted without an allowlist. Permit only the application's intended redirect destinations.", 31},
					{"Overly broad cross-origin policy", "MEDIUM", "src/server/cors.ts", "request.origin", "accessControlAllowOrigin", "Synthetic example: a broad origin policy requires review against the application's authentication and cross-origin requirements.", 18},
					{"Cookie missing secure attribute", "LOW", "src/auth/session.ts", "session.token", "response.cookie", "Synthetic example: review the session cookie's transport and same-site attributes against the deployment's HTTPS requirements.", 53},
					{"Request metadata in diagnostic logs", "LOW", "src/observability/logger.ts", "request.headers", "logger.debug", "Synthetic example: diagnostic logs may retain request metadata. Minimize logged fields and exclude credentials and personal data.", 24},
					{"Review development-only debug route", "INFO", "src/server/routes.ts", "environment", "debugRoute", "Synthetic example: confirm the diagnostic route is excluded from production configuration. This observation alone does not establish exposure.", 12},
				}
				for index, sample := range samples {
					results[index] = map[string]any{"id": fmt.Sprintf("showcase-%d", index+1), "similarityId": fmt.Sprintf("showcase-stable-%d", index+1), "type": "sast", "severity": sample.severity, "state": "TO_VERIFY", "status": "NEW", "description": sample.description, "data": map[string]any{"queryName": sample.title, "languageName": "TypeScript", "group": "Web application security", "nodes": []any{map[string]any{"fileName": sample.file, "line": sample.line, "name": sample.source}, map[string]any{"fileName": sample.file, "line": sample.line + 9, "name": sample.sink}}}}
				}
			}
			if id == "intel-demo" {
				for index, cve := range []string{"CVE-2024-1234", "CVE-2021-44228"} {
					results[index] = map[string]any{"id": fmt.Sprintf("sca-finding-%d", index+1), "similarityId": fmt.Sprintf("sca-stable-%d", index+1), "type": "sca", "severity": "HIGH", "state": "TO_VERIFY", "status": "NEW", "vulnerabilityDetails": map[string]any{"cveName": cve, "cvssScore": 8.1, "description": "Synthetic dependency finding for isolated intelligence verification."}, "data": map[string]any{"packageIdentifier": map[string]any{"name": "synthetic-component", "version": "1.0.0", "packageManager": "npm"}, "scaPackageData": map[string]any{"locations": []any{map[string]any{"path": "package.json"}}, "dependencyPaths": []any{}}}}
				}
			}
			report = map[string]any{"scanID": id, "totalCount": count, "results": results}
			if exists("wrongReport") {
				report.(map[string]any)["scanID"] = "other"
			}
			if exists("partialReport") {
				report.(map[string]any)["totalCount"] = count + 1
			}
			if exists("missingResults") {
				delete(report.(map[string]any), "results")
				report.(map[string]any)["totalCount"] = 0
			}
			if exists("nullResults") {
				report.(map[string]any)["results"] = nil
				report.(map[string]any)["totalCount"] = 0
			}
		}
		data, _ := json.Marshal(report)
		if exists("malformedReport") {
			data = []byte("broken")
		}
		if exists("oversizedReport") {
			data = make([]byte, 64<<20+1)
		}
		_ = os.WriteFile(filepath.Join(value("output-path"), "report."+extension), data, 0600)
		fmt.Println("Report created")
		return
	}
	os.Exit(3)
}
