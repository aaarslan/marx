# Changelog

## Unreleased

- Add a persistent SQLite workbench for jobs, logs, scan evidence, remediation sessions and investigation state, with atomic writes and protected retention.
- Reconcile known remote scan IDs after restart without resubmitting; preserve unknown submission/cancellation outcomes and distinguish partial completion.
- Pin original findings when tracking a remediation, record handoffs, change references and checks, and compare later verification evidence without overwriting the baseline.
- Qualify comparisons using scope, completeness, identities, severity escalation, source evidence and scan coverage. Count informational findings and retain unknown severities honestly.
- Group dependency fixes and SAST findings sharing concrete sink evidence, while preserving all original occurrences and vendor identities.
- Add a paged split investigation view, persistent filters and baseline, keyboard finding navigation, source freshness and VS Code/Cursor links.
- Discover nested npm/Yarn/pnpm workspaces, suggest affected packages, configure exact project mappings and per-item options in Batch, and page project-scoped history.
- Import complete CLI reports within the existing size bound, parse report JSON in a worker, schedule CLI work centrally, and cancel superseded imports safely.
- Export official SARIF and complete remediation bundles. Remove unused HTTP, JWT and ZIP implementations and their obsolete dependencies/tests.
- Replace npm minimatch implementations with Picomatch in workspace discovery and packaging, migrate ASAR crawling to fdir, preserve literal mapped/unpacked filenames, enforce archive link containment, and add reproducible packaging contract checks.

## 0.8.1

- Isolate scan logs from application-shell and unrelated-view updates to avoid continuous whole-application renders during scans.
- Use an opaque macOS window and solid application background instead of native vibrancy and full-window blur.
- Keep the live log in a fixed-height scrollable panel to prevent overflow and layout movement.
- Verify sustained CLI output preserves focus, scroll position, live elapsed time and navigation without rerendering the application shell.

## 0.8.0

- Check required CLI commands and flags locally before authentication or scan upload, including optional flags selected for the scan.
- Require protected OS storage for Marx-managed keys. Block legacy plaintext and unreadable keys without modifying them; support explicit replacement or removal.
- Save canonical repository-to-project mappings scoped to CLI configuration. Remove folder-name inference, block implicit reuse of existing project names, and show exact targets for batch scans.
- Require explicit comparison baselines. Default to the same branch, opt into other branches, validate baseline metadata, and clear comparisons when their scope changes.

## 0.7.0

- Add a local remediation-prompt builder for GitHub Copilot and other coding assistants.
- Select exact severities, current results filters, all loaded findings or a single finding, with structured evidence and source-flow context.
- Preview and copy numbered batches, add project-specific instructions, or save the full handoff as Markdown.
- Keep partial results and demo data explicit; never silently drop findings to fit a prompt.
- Inset dropdown chevrons consistently across the application while retaining native keyboard behavior and forced-color support.


## 0.6.0

- Run the installed official Checkmarx CLI for scans, projects, history, reports and triage.
- Add CLI executable discovery, a file picker, explicit configuration-file selection and CLI connection testing.
- Use existing CLI authentication by default, with optional Marx-managed API-key forwarding through the child environment.
- Show CLI submission and live output, bound subprocess resources, and report uncertain remote submission or cancellation outcomes.
- Preserve scan options, exclusions, batch scanning, story checks and structured findings.
- Add CLI process/adapter tests and an isolated Electron acceptance harness.

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
