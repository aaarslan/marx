# Native Windows x64 verification - October 31, 2026

Host: Windows 11 Pro x64. Commands ran in native PowerShell using Bun 1.4.4. Initial clean checkout was main at 7bedc71, the merge of PR #1, with 5dff13f included. Fetched origin and fast-forwarded feat/remediation-workbench to that merge before editing. PR #1 was already MERGED.

| Validation | Result | Evidence |
| --- | --- | --- |
| Frozen installation | Pass | Bun 1.4.4; no lockfile changes, 325 installed packages |
| TypeScript | Pass | Both compiler projects |
| Regression suite | Pass | 29 files; 176 passed, 10 intentionally skipped macOS-only cases (186 total) |
| Audit | Pass | Zero advisories across 340 checked packages |
| Packaging contracts | Pass | Four patches; 148 matcher assertions; native symlinks, 12 files and four ASAR variants; Windows drive/UNC containment assertions |
| NSIS x64 and directory builds | Pass | Both supported commands executed; final NSIS rebuilt after fixes |
| Production archive | Pass | Matches compiled files, all lazy views present, no source/tests/docs/node_modules/maps; report worker is bundled in main code and exercised by 5,051-finding imports |
| Unpacked executable | Pass | Actual Marx.exe rendered Scan and demo findings; IPC/DPAPI/SQLite write verified |
| Installer | Pass | Interactive per-user wizard, 0.8.1 icon/product resources; detected running Marx; completed installation |
| Installed executable | Pass | Launched with TEMP working directory, from Local Programs, outside repository; all requested views rendered |
| Synthetic core workflows | Pass within stated scope | CLI capabilities, obsolete CLI rejection, source mapping/containment, monitoring, failure/uncertainty, results/filter/paging, remediation notes and pinned evidence, source drift, explicitly inconclusive comparison, per-package batch settings |
| Large results | Pass | 5,051 findings, 100-row/group DOM bounds, page-three selection restored; actual installed app reopened 5,051 findings, one session and five jobs |
| Exports/clipboard | Pass | Installed CSV 407,057 bytes, JSON 3,051,622 bytes, evidence JSON 57,076 bytes; real clipboard readback; native SARIF save dialog with minimal synthetic SARIF |
| DPAPI/persistence | Pass | Disposable credential encrypted through app IPC; plaintext absent from key file; Electron safeStorage decrypted using same disposable profile after restart; SQLite workspace survived unpacked-to-installed restart |
| Cancellation/recovery | Pass within stated scope | Held synthetic submission canceled in installed app; Unknown outcome retained after restart, alongside four known scan IDs |
| GUI | Partial | Native Ctrl+O picker selected `a disposable source folder with Unicode, spaces, parentheses and brackets`; Ctrl+R exercised; navigation, maximize/restore/minimize, single-instance refocus and clean shutdown; 960x640 layout covered by Electron packaged-code harness |
| Uninstall | Pass | Interactive uninstaller completion, installed executable absent, disposable profile retained; no remaining Marx processes |

## Failures and repairs

- ASAR public lookup APIs require native separators on Windows. The verifier now normalizes lookup paths; archive bytes and extraction checks remain unchanged. No dependency patch change was necessary.
- Windows does not expose POSIX mode 0600 through stat. Permission-bit expectations now apply to POSIX only, matching existing workbench tests. This does not establish Windows ACL hardening.
- Workspace change-impact discovery used Promise.all, returning on the first failed Git command while the sibling still held the directory open. Promise.allSettled now waits for both before reporting failure. The existing non-Git-directory test reproduced the EBUSY failure; it passes without cleanup retries after the fix.
- The CLI acceptance harness rejected Windows and required a shebang executable. It now compiles a native temporary cx.exe with pinned Bun. Initial compilation inherited ELECTRON_RUN_AS_NODE and failed with a PE truncation error; clearing that variable fixed it. The main-process error dialog was from this harness failure, not a packaged startup crash.
- The mock initially only wrote JSON, causing SARIF export ENOENT. It now emits a minimal synthetic SARIF fixture for that format. This is fixture support, not live Checkmarx SARIF validation.
- Scan guidance said "your Mac" on Windows; changed to "your computer". Acceptance screenshots now remain in temporary evidence instead of rewriting documentation images.
- Attempting to rebuild while the unpacked executable was running produced Windows EPERM. Closing it resolved the file lock; no security protection was disabled.

## Artifact and evidence locations

Paths below are portable locations; generated temporary directory names are omitted.
Installer: `dist/Marx-0.8.1-win-x64-setup.exe`.
Unpacked: `dist/win-unpacked/Marx.exe`.
Installed (removed by uninstall): `%LOCALAPPDATA%/Programs/Marx/Marx.exe`.
Final installer SHA256: `E93F0518E784D5036D00F709DF9491F0A8B029ABD35FC049D585EE7EFF803D26`.
Machine-readable final harness and archive evidence are recorded beside this document. Acceptance screenshots and disposable profiles are kept locally in generated temporary directories; machine-specific paths are not published. These contain synthetic data only.

## Remaining coverage gaps

No live Checkmarx tenant was used. Notification delivery/click behavior, native drag-and-drop, actual editor deep-link launch, inaccessible Windows ACL fixtures, physical UNC-share access, database corruption/disk-exhaustion recovery, and confirmed remote cancellation/partial-engine outcomes were not established by this pass. Drive/UNC matcher tests are not network-share access tests. Synthetic tests establish local behavior only. Windows ARM64 was not built or tested. Installer is unsigned as configured.
