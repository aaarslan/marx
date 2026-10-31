# Security

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** action if it is available for this repository. If private reporting is unavailable, open an issue asking for a private contact channel without including vulnerability details.

Do not publish API keys, source archives, customer findings, presigned URLs or other sensitive data. A useful private report includes the affected version, reproduction steps, expected impact and a minimal synthetic example.

Security fixes target the latest version. A clean dependency audit does not establish that the application is free of vulnerabilities.

## Data handling

- The selected official Checkmarx CLI archives source locally and uploads it to Checkmarx One. Marx does not upload source through its own HTTP implementation. Default exclusions can be overridden; review the files you intend to send.
- Source archive handling belongs to the selected CLI. Marx's JSON and SARIF reports use private temporary directories and are removed after reading.
- CLI processes are launched with separate arguments and no shell. Native CLI configuration is the default; optional Marx-managed keys are passed through the child environment. Marx does not rewrite the CLI configuration. Known environment secrets, JWTs and signed upload URL parameters are redacted from captured CLI output; logs and reports can still contain source and finding information.
- Settings use the per-user `MarxWails` application-data directory, or an explicitly selected disposable test profile. A separate credential file is encrypted using Windows DPAPI. Protected OS storage is required for Marx-managed credentials.
- DPAPI encryption/decryption runs directly in the Go application; credentials are never passed as command-line arguments or through a helper process. Plaintext fallback is disabled. Electron credential files are not migrated.
- The interface runs in WebView2 without Node integration. CSP disables frames, objects, remote scripts, forms, and remote resources. The asset middleware denies frame requests and sets frame-ancestor and MIME protections. Native operations invoke the Go engine directly through bounded Wails service calls. Source access requires an authorized folder and matching project mapping, with containment and size checks.
- Repository mappings store canonical folder paths, project IDs and names, and a SHA-256 configuration fingerprint. Configuration contents and credentials are not stored in the mapping records. CLI profile or environment changes invalidate the mapping; a project-ID lookup is checked before submission.
- The workbench database stores normalized findings, source and configuration fingerprints, scan options, job logs, remediation notes and assistant handoffs. This evidence is not encrypted by Marx and can contain source fragments or sensitive project information. Windows relies on profile directory ACLs for the database, WAL and SHM files. No CLI configuration contents or credentials are intentionally added to the database.
- Session evidence is pinned separately from refreshed results. Cleanup preserves evidence referenced by a session or unresolved job. Explicitly deleting a session removes its pinned copies; SQLite deletion is not guaranteed secure erasure. Protect device backups and exported bundles separately.
- Marx has no analytics service or separate application backend. Links explicitly opened by the user are delegated to the system browser.

Never commit application-support data, environment secrets, signing keys or private tenant fixtures. Local logs and exported findings may contain sensitive project information; inspect and redact them before sharing.

## Distribution

Windows x64 installers are unsigned and do not provide a verified publisher identity. This branch has not qualified macOS or Linux packaging.

## Wails framework limitation

[Wails 3.0.0's release notes](https://github.com/wailsapp/wails/releases/tag/v3.0.0) identify GHSA-2p5f-2gx8-mh8m as partly fixed. Embedded child frames can still access bound methods in some configurations, including the HTTP runtime endpoint. Marx does not embed external pages or frames and sends external links to the system browser. CSP and request middleware block frames; these are application mitigations, not a claim that the framework is fully patched. Do not add embedded content without reevaluating this boundary. Go vulnerability scans currently do not report this release-note limitation.

Never publish local account paths, profile names, machine inventories, private findings, logs or credentials in verification records. Executables are built with Go path trimming and without VCS metadata. Audit generated assets and diffs before committing.

See [current limitations](docs/limitations.md) and [Wails validation](docs/wails-migration.md).
