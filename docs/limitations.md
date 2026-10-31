# Current limitations

The current target is native Windows 11 x64 using Wails 3.0.0, Go 1.27.3 and WebView2. The Go engine and single-executable NSIS package have native synthetic workflow coverage. Earlier Electron verification records are historical. See [the current verification report](wails-migration.md).

## Integration boundaries

All scan acceptance used a synthetic Go CLI and disposable data. No live Checkmarx tenant, real source upload, organization proxy/certificate setup, live triage or server-side notification outcome is claimed. Use the organization's approved CLI; capability help checks cannot prove tenant compatibility. Native notification submission and click routing are implemented, but OS toast delivery and clicking a toast were not manually qualified. Physical UNC shares, manual Explorer folder-drop gestures, installed editor-link launches and full screen-reader behavior remain unqualified. Native local source paths with spaces, Unicode, parentheses, brackets and mixed separators have Go coverage.

The Wails child-frame/native-bridge limitation remains disclosed in [SECURITY.md](../SECURITY.md). Frames and remote resources are blocked. The installer is unsigned, requires WebView2, and targets x64 only. Other operating systems/architectures are outside this verification.

## Evidence and workflow bounds

- All findings within the 64 MiB report limit are imported, including the tested 5,051-finding case. Incomplete reports remain marked truncated; unsupported scanners and unknown severities remain visible. The interface keeps the full normalized scan in memory and pages displayed rows.
- A passing remediation verification requires complete, compatible evidence, stable finding identities, successful engine coverage and effective server configuration. Ordinary CLI scan metadata does not establish all of that evidence. Missing findings alone cannot prove a fix. Original session evidence is pinned separately from refreshed results.
- Source fingerprints cover bounded local files, not an immutable CLI upload archive. Source may change during packaging/upload; source freshness is advisory and this gap prevents conclusive verification.
- CLI connection identity hashes executable/configuration/environment data; it is not a server-issued tenant identity. Mappings must match before source access or upload. Project selection checks project identity and unique name resolution.
- Upload/archive handling belongs to the CLI. Marx does not retry submissions. A stopped submission may already have been accepted remotely; without a scan ID, check Checkmarx One before retrying. Known IDs can be reconciled without resubmission. Remote cancellation requires a subsequent status check.
- At most eight scan jobs, ten ordinary CLI commands and two reserved cancellation commands run concurrently. The ordinary queue is bounded at 128 requests and desktop operations at 256. CLI stdout is capped at 64 MiB, stderr at 1 MiB and help at 512 KiB. Submissions time out after 30 minutes, reports after ten minutes and monitoring after 24 hours. Three unrecognized statuses stop monitoring as Unknown. Summary failures do not change a remotely completed scan to Failed.
- Reports use private temporary directories and are removed after reading. Source snippets are bounded at 8 MiB and use rooted filesystem access. Provenance capture is limited to 20,000 files, 16 MiB per file and 256 MiB total.
- The project picker loads up to 1,000 projects. Workspace discovery supports npm/Yarn patterns and pnpm block lists, with bounds on expansion, directories, entries, nesting and project count. Other build-system dependency graphs are not parsed. Per-package uploads omit files outside that folder; shared lockfiles may need a root scan. Batches contain at most 200 packages and run at concurrency 1–4.
- SQLite stores normalized findings, jobs, the latest 1,000 log lines per job, pinned evidence, notes and handoffs. Cleanup is explicit and retains unresolved jobs and referenced evidence. Data is not encrypted by Marx; Windows profile ACLs protect local files. Deletion is not secure erasure.
- Electron and earlier prototype databases are not migrated. Unsupported schema versions and corrupt databases are preserved and rejected. Reopening committed/WAL data after process termination was tested; recovery of damaged databases or disk exhaustion was not qualified.

Go race-detector execution was unavailable because this native toolchain has CGO disabled and no configured C compiler. Concurrency, shared-import cancellation, reserved CLI capacity, shutdown and crash recovery have executed functional regression coverage; this is not a claim that a race-detector run passed.
