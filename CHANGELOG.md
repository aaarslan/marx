# Changelog

## 0.5.0 — 2026-10-29

- Add unsigned Windows x64 and ARM64 NSIS installers, native window chrome, platform shortcuts and Windows folder-name handling.
- Generate a Windows icon and keep ad-hoc signing specific to macOS.
- Remove redundant bundler input overrides that caused editor configuration diagnostics.
- Minify main/preload output, defer ZIP support until scanning, and load secondary views on demand while preserving the scan draft.
- Reduce combined main JavaScript from about 579 KB to 260 KB and the initial renderer entry from 288 KB to 251 KB in local production builds.
- Add regression coverage for cross-platform paths, signing-hook isolation and the Windows icon.

## 0.4.2 — 2026-10-29

- Block automatic project creation when project discovery is incomplete.
- Preserve tenant project totals and reject malformed or duplicate listing entries.
- Cover pagination boundaries, project reuse, creation and cancellation with focused tests.

## 0.4.1 — 2026-10-29

- Keep long project names, branches and source paths readable in tables.
- Improve layouts at enlarged zoom levels and keep navigation reachable.
- Support reduced transparency and increased contrast.
- Format counts and timestamps, including future and malformed dates.

## 0.4.0 — 2026-10-29

- Move installation, development, testing and packaging to Bun.
- Update the Electron, React, TypeScript and build toolchain.
- Enable the renderer sandbox and restrict IPC and local source access.
- Improve keyboard navigation, demo filtering, progress feedback and settings behavior.

## 0.3.1 — 2026-10-29

- Stream ZIP archives and uploads instead of buffering entire source archives.
- Harden cancellation, polling, token refresh and incomplete-result handling.
- Enforce source-file containment and private settings-file permissions.
- Add regression coverage and check both TypeScript projects explicitly.

## 0.3.0 — 2026-10-29

- Add the desktop scanning workflow, findings explorer, triage, exports, scan comparisons, story checks and batch scans.
