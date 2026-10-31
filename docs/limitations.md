# Current limitations and validation gaps

Marx is a young client. Local unit tests, mock transports and sample-data UI checks cover application behavior, but they do not prove acceptance by every Checkmarx One tenant.

## Live tenant validation

The following still require a real API key and tenant:

- CLI authentication and organization-specific proxy/certificate configuration.
- Complete SAST/SCA scan submission, execution and notification delivery/click behavior.
- Live result fetching, SAST/SCA triage and story-check comparison.
- Scan-summary counts compared with the web UI, including omitted-zero or nested-engine payloads.
- SCA dependency/location payloads compared with actual findings.
- Credential access and macOS consent under the installed app's signing identity.

Treat these as unverified integration paths, not as passed checks.

## Data and workflow bounds

- **CLI required:** Marx uses an installed official `cx` executable. It does not bundle, download or update it. CLI 2.3.69 was checked locally; older versions may lack required flags. Local capability preflight checks required command help and scan flags before authentication in the connection test and before source submission. An unsupported command fails visibly without falling back to direct HTTP. Capability checks cannot prove tenant compatibility.
- **Uploads:** packaging, upload limits and multipart handling belong to the selected CLI. Source still leaves the laptop for Checkmarx One analysis.
- **Environment:** desktop apps may not inherit variables exported only in an interactive shell. Select the working CLI executable and, where needed, its explicit configuration file. Marx inherits its launch environment and does not source shell startup files.
- **Results:** all findings returned within the 64 MiB report bound are imported; reported/received/normalized counts and unsupported data remain explicit. The UI pages rows, but keeps the full normalized scan in memory for filters and grouping. Very large reports are not an unlimited-memory workflow. Incomplete or ambiguous evidence cannot produce a passing verification.
- **Mappings and comparisons:** canonical folder mappings are scoped to a fingerprint of CLI configuration and environment, not a server-issued tenant identity. Project IDs are validated by lookup before upload. Settings changes invalidate mappings. Baselines require explicit selection, an earlier completed scan of the same project, and same-branch scope unless other branches are enabled. Effective server configuration and successful engine coverage are required for a conclusive pass; the checked CLI's ordinary scan view does not establish all of this evidence. Observed changes remain available with explicit inconclusive reasons.
- **Source evidence:** Marx captures a bounded working-folder fingerprint before submission, not the CLI's immutable upload archive. It does not establish that files stayed unchanged throughout packaging. Current-checkout freshness is advisory. Source identity gaps remain visible and block conclusive verification.
- **Projects:** the picker loads up to 1,000 projects. Submission performs a name-filtered lookup and blocks ambiguous or mismatched existing selections because the CLI creates scans by project name. Project creation is handled by the CLI.
- **Unknown submission outcomes:** a canceled, failed or timed-out submission may already have been accepted remotely. Marx does not retry scan submissions and disables the CLIâ€™s network retry for them. If no scan ID was captured, reconcile in Checkmarx One before retrying.
- **Cancellation:** Marx terminates the local command and, when a scan ID is known, requests remote cancellation through the CLI, then checks remote status. Killing a local process or receiving a successful cancel command alone does not prove remote cancellation. Unconfirmed outcomes remain Unknown. An empty project or accepted scan can remain if the command stops before returning its ID.
- **Superseded fetches:** result imports are shared by scan/connection and support cancellation, including cancellation during connection lookup. The last canceled reader aborts the import. Commands already accepted remotely cannot necessarily be undone by terminating their local reader.
- **Monitoring:** local CLI-capacity failures have bounded retries. Unrecognized statuses are sampled three times; persistent unknowns or exhausted monitoring requests stop local monitoring with remote status Unknown, rather than claiming the remote scan failed. Summary command failures are logged and do not turn a remotely completed scan into a failed scan.
- **Process/report limits:** at most eight active scan jobs, ten ordinary CLI processes and two reserved control slots, with a bounded 128-command queue. Commands have timeouts, stdout/stderr capture is capped at 32 MiB, and reports larger than 64 MiB are not loaded. Report parsing runs in a worker with a 60-second bound. Reports are deleted after reading. A scan submission can run for up to 30 minutes, monitoring for up to 24 hours, and a report command for up to 10 minutes.
- **SCA triage:** the CLI requires package name, version, manager and vulnerability ID. Incomplete metadata blocks triage and directs users to Checkmarx One.
- **Session retention:** SQLite stores jobs, snapshots, pinned session evidence and the latest 1,000 log lines per job across restarts. Cleanup is explicit; active/unresolved jobs and session evidence are protected. The evidence database is not encrypted by Marx. Long unattended sessions and system-wide disk exhaustion are not fully qualified.
- **Workspace planning:** npm/Yarn workspaces and pnpm block-list packages are supported; other build-system workspace graphs are not parsed. Discovery, glob expansion, directory depth and batch size are bounded with visible warnings. Change impact considers uncommitted files and declared local JavaScript package dependencies, not every possible runtime relationship. Per-package uploads omit root files outside the selected folder; shared lockfiles may require a root scan.

## Platform and accessibility

- Packaged targets are macOS ARM64 and Windows x64/ARM64. Windows x64 has native installation, executable launch, DPAPI credential round-trip, SQLite persistence and uninstall coverage on Windows 11 Pro x64 (October 31, 2026). Windows ARM64 remains unverified natively. See [the Windows evidence record](native-windows-verification.md) for coverage boundaries; native notification delivery/click behavior remains unverified. Intel macOS and Linux are not supported release targets.
- Workbench changes have local Electron runtime coverage with synthetic data on Linux/Xvfb, including the actual SQLite module and report worker. This does not substitute for native macOS/Windows installation, credential and signing tests.
- macOS builds are ad-hoc signed and not notarized. First launch may require explicit macOS approval. Windows installers are unsigned.
- Fresh-copy startup has shown a delay between page load and the first rendered window. Repeated launches were faster in local checks; a consistently sub-second first launch is not established.
- Keyboard navigation, enlarged layouts and display preferences have local coverage. Full screen-reader and broader accessibility qualification remain open.
- Platform preset discovery is unavailable through the unified API used here. Named presets must be entered manually.
- Exploitable Path availability and language coverage are controlled by Checkmarx One.

## Security boundaries

The local dependency audit on October 31, 2026 reports no known vulnerabilities across 340 checked packages after a fresh frozen-lockfile installation. The npm minimatch implementations have been replaced by Picomatch, and ASAR's glob 7 crawler by fdir, using four version-pinned consumer patches. Workspace discovery also uses Picomatch instead of Node's internally minimatch-backed `path.matchesGlob`. Historical dependency slot names remain as aliases to the real replacement packages; no advisory is suppressed. The patches require review when their upstream packages change, and custom packaging patterns follow Picomatch syntax. See [dependency maintenance and verification](dependencies.md) for the exact contract and upgrade process. Electron still contains Node's internal libraries; the embedded runtime has not been replaced.

Marx-managed credentials require OS-backed encryption. Plaintext fallback is disabled, and legacy or unreadable keys are preserved but blocked. Storage and local file permissions are documented in [SECURITY.md](../SECURITY.md). React inline styles currently require a CSP exception for inline styles. No claim of zero vulnerabilities or a completed security certification is made.
