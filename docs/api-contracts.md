# Checkmarx One CLI contracts

Marx runs the official installed `cx` executable. The native bridge dispatches through `native/engine/dispatch.go`; `native/engine/cli.go` constructs and runs CLI commands. Go owns source selection, process containment, report parsing and persistence. The Electron backend and custom HTTP upload path have been removed. Optional public CVE lookups are a separate, explicitly enabled read-only intelligence boundary.

The checked baseline is official [CLI release 2.3.69](https://github.com/Checkmarx/ast-cli/releases/tag/2.3.69). Its macOS universal archive SHA-256 is `3f7314f9a8c766e11bac53705573472fd356ded7fe58036ed702a54a82a4303d`, matching the release checksums. Source formats were inspected at upstream commit `df0e6114d8cfc29848b8f3fb9ed54a51ddcc27e9`. The real binary’s version and help commands were run locally; authenticated tenant execution remains unverified.

## Execution and authentication

- Resolve an explicit absolute executable path first, or discover `cx` / `cx.exe` from absolute PATH entries. macOS discovery also checks Homebrew locations. A configured-path failure never selects another executable.
- Launch directly with argument arrays and no shell; the source directory is an absolute `--file-source` value. Commands run from the user home directory, avoiding executable or configuration lookup from the scanned project.
- Native mode inherits the CLI’s configuration and launch environment. An optional absolute `--config-file-path` selects an existing CLI configuration file.
- Marx-managed mode supplies `CX_APIKEY`, optionally `CX_BASE_URI` and `CX_TENANT`, only to the child environment. No key is added to argv or written to CLI configuration.
- Connection testing runs `version`, `auth validate`, and a one-project list query. Successful authentication alone does not establish upload permission.

## Commands

| Operation | CLI command and structured output |
| --- | --- |
| Projects | `project list --format=json --filter=limit=100,offset=0,sort=name`, paged to 1,000 |
| Submission | `scan create --file-source=<folder> --project-name=<name> --branch=<branch> --scan-types=sast,sca --async --scan-info-format=json --retry=0` |
| Monitoring | `scan show --scan-id=<id> --format=json`, every five seconds |
| History | `scan list --format=json --filter=limit=50,offset=0,project-id=<id>,sort=-created_at`, with optional project scope and paging |
| Cancellation | `scan cancel --scan-id=<id> --retry=0` |
| Findings | `results show --scan-id=<id> --report-format=json --output-name=report --output-path=<private temporary directory>` |
| Counts | The same report command with `--report-format=summaryJSON` |
| SARIF export | The same report command with `--report-format=sarif`; original validated SARIF 2.1.0 bytes are exported |
| Triage | `triage update` with project, scanner, state, comment and scanner-specific identity flags; `--retry=0` |

Submission explicitly maps SAST preset, incremental/full mode, optional base branch, SCA Exploitable Path, and scan tags. Marx’s effective default and custom exclusions use `--skip-default-filter` plus CLI file filters. Basename patterns use `--file-filter`; path patterns use `--file-filter-ext`. `.git` is also covered by `--exclude-git-folder` when it is in the effective exclusion list. Commas and newlines in exclusion patterns are rejected because those CLI options use comma delimiters. Colons, commas and newlines inside tag names or values are rejected before submission because the CLI would otherwise truncate or split them.

The CLI selects projects by name. Before submission Marx runs a name-filtered lookup, rejects duplicate exact names or a mismatch with the selected project ID, and validates the returned project ID. If a name-resolution race submits to an unexpected project, Marx requests cancellation of that exact newly returned scan and reports the mismatch. CLI creation of a new project remains a remote mutation.

## JSON output

Project and scan commands return views with fields such as `ID`, `Name`, `ProjectID`, `ProjectName`, `Status`, `Branch`, `CreatedAt` and `MainBranch`. The adapter accepts their lower-case API equivalents too. Metadata parsing tolerates diagnostic text surrounding a JSON document.

The `json` findings report supplies `results`, `totalCount` and `scanID`. The CLI’s null result slice is accepted as empty only when the explicit total is zero. Reports without an explicit valid total or with a supplied mismatched scan ID are rejected; an absent report scan ID is accepted using the explicitly requested scan identity. Marx imports every returned record within the 64 MiB report bound, preserves reported/received/normalized/unsupported counts, and records incomplete imports explicitly. Report import runs in Go with bounded file reads and shared import cancellation. Normalized scan snapshots are stored in SQLite records. The renderer retains the loaded scan for filtering and grouping and displays 100 findings per page.

SCA report string identifiers and string locations are adapted to the findings model; exact name/version metadata comes from matching dependency-path entries. Dependency paths and vendor redundancy hints are preserved. Duplicate vendor IDs receive deterministic local occurrence IDs while keeping the vendor ID; indistinguishable occurrences remain ambiguous for comparisons. Unknown severities stay Unknown rather than becoming Info. Missing metadata does not establish triage eligibility.

The `summaryJSON` report supplies `CriticalIssues`, `HighIssues`, `MediumIssues`, `LowIssues` and `InfoIssues`. Every count must be a nonnegative integer; an unavailable or unrecognized report remains unavailable rather than displaying zero vulnerabilities.

## Cancellation and failure

Commands have bounded timeouts, captured output and concurrency. Monitoring retries local capacity failures at most five times with exponential backoff and jitter (under one minute of backoff). An initial New status is treated as queued; three consecutive unknown statuses stop local monitoring without claiming a remote failure. Cancellation sends SIGTERM, followed by SIGKILL after three seconds if necessary. The runner remembers submitted scan identity and uses the CLI to request remote cancellation when known. An interrupted submission without an ID is reported as an unknown remote outcome. Scan creation and triage are never automatically retried by Marx; submission passes `--retry=0` to the CLI too.

The central scheduler permits ten ordinary commands, reserves two slots for control work, and bounds its waiting queue at 128 commands. Scan cancellation uses the separate control lane. Other commands share the ordinary lane and have a bounded wait for capacity. Superseded result imports can be canceled; shared readers retain an import until its last reader releases it. A successful cancel command is followed by a status query before a scan is labeled Canceled.

Jobs are recorded before submission. After restart, known IDs in the current connection are reconciled without resubmission; jobs without IDs remain Unknown for manual investigation. See [the workbench storage and verification contract](workbench.md).

Native engine and process tests exercise command construction, executable CLI fixtures, failure handling, report normalization and containment. `bun run verify:runtime` exercises the real Wails webview with an acceptance-tagged host, an isolated synthetic CLI and a disposable profile. These checks make no live tenant calls and do not establish upload permission. See [building and verification](building.md).

## Public intelligence and local decisions

`src/shared/api-contract.ts` defines the renderer API; `src/renderer/src/desktop.ts` maps it to the native `intel:*` channels. Intelligence settings, cached reads, explicit refresh/cancel, watchlist, decisions, revision history and decision export are separate operations. Reads and local decision writes do not initiate provider requests. Provider origins are fixed, sources default disabled, and refreshes have bounded concurrency, response sizes and timeouts.

JSON finding exports add current cached intelligence. Remediation bundles retain original `intelligence` and separate `currentIntelligence`; decision archives include immutable revisions and retained review-trigger evidence. CSV and CLI SARIF formats remain unchanged. Local decisions never invoke remote triage. See [CVE intelligence](cve-intelligence.md) for the exact disclosure, states and limits, and [final acceptance](final-acceptance.md) for outstanding platform checks.
