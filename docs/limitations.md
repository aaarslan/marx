# Current limitations and validation gaps

Marx is a young client. Local unit tests, mock transports and sample-data UI checks cover application behavior, but they do not prove acceptance by every Checkmarx One tenant.

## Live tenant validation

The following still require a real API key and tenant:

- Authentication and discovered endpoint persistence.
- Complete SAST/SCA scan submission, execution and notification delivery/click behavior.
- Live result fetching, SAST/SCA triage and story-check comparison.
- Scan-summary counts compared with the web UI, including omitted-zero or nested-engine payloads.
- SCA dependency/location payloads compared with actual findings.
- Credential access and macOS consent under the installed app's signing identity.

Treat these as unverified integration paths, not as passed checks.

## Data and workflow bounds

- **Uploads:** one presigned PUT, capped at approximately 900 MiB. Multipart uploads are not implemented.
- **Results:** at most 5,000 findings are loaded. The UI warns when results are incomplete, exports contain only loaded findings, and diff/verdict are suppressed for incomplete data.
- **Projects:** discovery currently loads up to 1,000 projects. Automatic creation is blocked if the list is incomplete and no matching project was found. Projects beyond the cap need a future paginated picker or a verified server-side lookup.
- **Unknown submission outcomes:** a timed-out scan or project creation request may already have been accepted remotely. Do not automatically retry a mutation whose outcome is unknown; reconcile it in Checkmarx One first.
- **Cancellation:** canceling after a project-creation request has been dispatched can leave an empty remote project.
- **Superseded fetches:** stale renderer results are ignored, but a superseded main-process result fetch is not currently canceled. Fetch concurrency is bounded per operation rather than globally across rapid navigation.
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
