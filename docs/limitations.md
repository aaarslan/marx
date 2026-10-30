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

- **CLI required:** Marx uses an installed official `cx` executable. It does not bundle, download or update it. CLI 2.3.69 was checked locally; older versions may lack required flags. An unsupported command fails visibly without falling back to direct HTTP.
- **Uploads:** packaging, upload limits and multipart handling belong to the selected CLI. Source still leaves the laptop for Checkmarx One analysis.
- **Environment:** desktop apps may not inherit variables exported only in an interactive shell. Select the working CLI executable and, where needed, its explicit configuration file. Marx inherits its launch environment and does not source shell startup files.
- **Results:** at most 5,000 findings are loaded. The UI warns when results are incomplete, exports contain only loaded findings, and diff/verdict are suppressed for incomplete data.
- **Projects:** the picker loads up to 1,000 projects. Submission performs a name-filtered lookup and blocks ambiguous or mismatched existing selections because the CLI creates scans by project name. Project creation is handled by the CLI.
- **Unknown submission outcomes:** a canceled, failed or timed-out submission may already have been accepted remotely. Marx does not retry scan submissions and disables the CLI’s network retry for them. If no scan ID was captured, reconcile in Checkmarx One before retrying.
- **Cancellation:** Marx terminates the local command and, when a scan ID is known, requests remote cancellation through the CLI. Killing a local process alone does not prove remote cancellation. Cancellation failures are shown explicitly. An empty project or accepted scan can remain if the command stops before returning its ID.
- **Superseded fetches:** stale renderer results are ignored, but a superseded main-process result fetch is not currently canceled. Fetch concurrency is bounded per operation rather than globally across rapid navigation.
- **Monitoring:** local CLI-capacity failures have bounded retries. Unrecognized statuses are sampled three times; persistent unknowns or exhausted monitoring requests stop local monitoring with remote status Unknown, rather than claiming the remote scan failed. Summary command failures are logged and do not turn a remotely completed scan into a failed scan.
- **Process/report limits:** at most eight active scan jobs and twelve simultaneous CLI processes; excess operations fail as busy. Commands have timeouts, stdout/stderr capture is capped at 32 MiB, and reports larger than 64 MiB are not loaded. Reports are deleted after reading. A scan submission can run for up to 30 minutes, monitoring for up to 24 hours, and a report command for up to 10 minutes.
- **SCA triage:** the CLI requires package name, version, manager and vulnerability ID. Incomplete metadata blocks triage and directs users to Checkmarx One.
- **Session retention:** renderer job history and per-job logs are retained for the app session. Logs are capped per job; long unattended sessions have not been fully qualified.

## Platform and accessibility

- Packaged targets are macOS ARM64 and Windows x64/ARM64. Both Windows installers have been cross-built on macOS; installation, launch, notifications and credential storage still require validation on a Windows host. Intel macOS and Linux are not supported release targets.
- macOS builds are ad-hoc signed and not notarized. First launch may require explicit macOS approval. Windows installers are unsigned.
- Fresh-copy startup has shown a delay between page load and the first rendered window. Repeated launches were faster in local checks; a consistently sub-second first launch is not established.
- Keyboard navigation, enlarged layouts and display preferences have local coverage. Full screen-reader and broader accessibility qualification remain open.
- Platform preset discovery is unavailable through the unified API used here. Named presets must be entered manually.
- Exploitable Path availability and language coverage are controlled by Checkmarx One.

## Security boundaries

Credentials use OS-backed encryption when available; the plaintext fallback and local file permissions are documented in [SECURITY.md](../SECURITY.md). React inline styles currently require a CSP exception for inline styles. No claim of zero vulnerabilities or a completed security certification is made.
