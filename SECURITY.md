# Security

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** action if it is available for this repository. If private reporting is unavailable, open an issue asking for a private contact channel without including vulnerability details.

Do not publish API keys, source archives, customer findings, presigned URLs or other sensitive data. A useful private report includes the affected version, reproduction steps, expected impact and a minimal synthetic example.

Security fixes target the latest version. A clean dependency audit does not establish that the application is free of vulnerabilities.

## Data handling

- Source selected for a scan is archived locally and uploaded to Checkmarx One through a presigned endpoint. Default exclusions can be overridden; review the files you intend to send.
- Archives use private temporary files and are cleaned up when a job settles.
- Settings are stored under Electron's per-user application-data directory. The API key is stored in a separate credential file, encrypted with Electron `safeStorage` when OS encryption is available.
- On macOS, `safeStorage` uses Keychain-backed encryption; on Windows it uses DPAPI. If encryption is unavailable, the current fallback stores the credential as plaintext. Files request mode `0600` on POSIX systems; Windows protection depends on the user-profile directory ACLs.
- The renderer uses context isolation, a sandboxed preload and no Node integration. Main-process source access requires a selected or previously authorized folder, and snippet reads enforce path containment and size limits.
- Marx has no analytics service or separate application backend. Links explicitly opened by the user are delegated to the system browser.

Never commit application-support data, environment secrets, signing keys or private tenant fixtures. Local logs and exported findings may contain sensitive project information; inspect and redact them before sharing.

## Distribution

Local macOS builds are ad-hoc signed, not notarized. Approve only builds you trust through the macOS security controls. The current signing workflow does not use a Developer ID certificate or a private signing key in this repository.

Windows installers are unsigned and do not provide a verified publisher identity. The macOS signing hook is skipped on Windows.

See [current limitations](docs/limitations.md) for integration and validation boundaries.
