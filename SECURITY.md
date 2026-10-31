# Security

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** action if it is available for this repository. If private reporting is unavailable, open an issue asking for a private contact channel without including vulnerability details.

Do not publish API keys, source archives, customer findings, presigned URLs or other sensitive data. A useful private report includes the affected version, reproduction steps, expected impact and a minimal synthetic example.

Security fixes target the latest version. A clean dependency audit does not establish that the application is free of vulnerabilities.

## Data handling

- The selected official Checkmarx CLI archives source locally and uploads it to Checkmarx One. Marx does not upload source through its own HTTP implementation. Default exclusions can be overridden; review the files you intend to send.
- Source archive handling belongs to the selected CLI. Marx's JSON and SARIF reports use private temporary directories and are removed after reading.
- CLI processes are launched with separate arguments and no shell. Native CLI configuration is the default; optional Marx-managed keys are passed through the child environment. Marx does not rewrite the CLI configuration. Known environment secrets, JWTs and signed upload URL parameters are redacted from captured CLI output; logs and reports can still contain source and finding information.
- Settings are stored under Electron's per-user application-data directory. The API key is stored in a separate credential file, encrypted with Electron `safeStorage`. Protected OS storage is required for Marx-managed credentials.
- On macOS, `safeStorage` uses Keychain-backed encryption; on Windows it uses DPAPI. If protected encryption is unavailable, Marx refuses to save or decrypt credentials. Legacy plaintext and unreadable key files are preserved and blocked until explicitly replaced or removed. Native CLI authentication remains available. Files request mode `0600` on POSIX systems; Windows protection depends on the user-profile directory ACLs.
- The renderer uses context isolation, a sandboxed preload and no Node integration. Main-process source access requires a selected or previously authorized folder, and snippet reads require a matching repository-to-project mapping and enforce path containment and size limits.
- Repository mappings store canonical folder paths, project IDs and names, and a SHA-256 configuration fingerprint. Configuration contents and credentials are not stored in the mapping file. CLI profile or environment changes invalidate the mapping; a project-ID lookup is checked before submission.
- The workbench database stores normalized findings, source and configuration fingerprints, scan options, job logs, remediation notes and assistant handoffs. This evidence is not encrypted by Marx and can contain source fragments or sensitive project information. Database, WAL and SHM files request `0600` on POSIX; Windows relies on profile directory ACLs. No CLI configuration contents or credentials are intentionally added to the database.
- Session evidence is pinned separately from refreshed results. Cleanup preserves evidence referenced by a session or unresolved job. Explicitly deleting a session removes its pinned copies; SQLite deletion is not guaranteed secure erasure. Protect device backups and exported bundles separately.
- Marx has no analytics service or separate application backend. Links explicitly opened by the user are delegated to the system browser.

Never commit application-support data, environment secrets, signing keys or private tenant fixtures. Local logs and exported findings may contain sensitive project information; inspect and redact them before sharing.

## Distribution

Local macOS builds are ad-hoc signed, not notarized. Approve only builds you trust through the macOS security controls. The current signing workflow does not use a Developer ID certificate or a private signing key in this repository.

Windows installers are unsigned and do not provide a verified publisher identity. The macOS signing hook is skipped on Windows.

See [current limitations](docs/limitations.md) for integration and validation boundaries.
