# Wails migration verification

Verified on native Windows 11 x64 on October 31, 2026. This branch starts from main after PR #3. No Electron data compatibility is attempted. All workflow verification used disposable profiles and synthetic CLI responses, not a live tenant.

## Implementation

- Wails 3.0.0 with Go 1.27.3 provides the desktop host and Microsoft WebView2 interface.
- The existing TypeScript workflow engine is compiled with Bun 1.4.4 into `marx-core.exe`. SQLite, report parsing workers, CLI process management, evidence pinning, and remediation logic remain in this engine.
- Host/engine communication uses inherited pipes, with bounded requests and messages. There is no application network listener. A Windows job object removes the engine and its descendants when the host closes.
- Go provides dialogs, clipboard, external links, notifications and click routing, single-instance focus, folder-drop delivery and DPAPI. Frame embedding and remote resources are disabled. The accepted upstream Wails child-frame limitation remains documented in SECURITY.md.
- Electron packages, ASAR adaptations and packaging patches are removed. A minimal Go resource generator replaces the Wails CLI in the build to avoid unrelated CLI dependencies.

## Executed checks

| Validation | Result |
| --- | --- |
| Frozen Bun installation | Pass, lockfile unchanged |
| Latest frontend versions | `bun outdated` reports no newer versions |
| Latest modules compiled into app/resource tool | No available updates reported for their resolved module paths |
| TypeScript | Pass for backend and renderer projects |
| Workflow tests | 161 passed across 25 files; four obsolete Electron-specific test files removed |
| Go tests | Four native tests passed: frame boundary, DPAPI, duplicate-dialog guard, missing-engine shutdown |
| Go vet | Pass |
| JavaScript audit | Zero advisories across 96 checked packages |
| Go source/resource-tool and compiled application scans | No findings from govulncheck; the Wails release-note limitation is separately disclosed |
| Wails synthetic acceptance | Pass: all views, CLI capabilities and connection, submission/monitoring/events, worker import of all 5,051 findings, bounded GUI paging, notes, pinned session evidence, inconclusive verification, uncertain cancellation and restart recovery |
| Native credentials and clipboard | DPAPI encrypt/decrypt round-trip; plaintext absent from saved blob; real clipboard IPC/readback |
| Native dialogs | Folder picker selected a disposable source with spaces, Unicode, parentheses and brackets; prompt-save dialog wrote the expected synthetic text |
| Windows resources | Executable product name Marx and version 0.9.0 verified |
| NSIS installation and installed launch | Exit 0; installed executable launched with a working directory outside the source checkout and restored 5,051 findings from a disposable profile |
| Clean shutdown and uninstall | Final uninstall exit 0; both installed executables removed, no Marx/engine processes left, disposable SQLite profile retained |
| Privacy | Home-directory paths absent from executable bytes; public records omit account paths, host inventory and temporary profile identifiers |

## Size

The Wails installer is approximately 45.6 MB, compared with the locally built Electron 0.8.1 installer at approximately 121.3 MB: about 62% smaller. The Go executable is approximately 11.5 MB and the compiled Bun sidecar approximately 115.4 MB before installer compression. These are measured artifacts, not guarantees for future builds. This architecture still ships a JavaScript runtime in the sidecar; WebView2's shared system runtime is not included in these application sizes.

## Fixes found during migration

JSON transport represents omitted array entries as null. The bridge now restores omitted optional arguments before invoking workflow handlers; otherwise result loading failed. Native clipboard operations are awaited. The drop handler unwraps the workflow result before emitting a folder path. Notifications retain identifiers for native click routing. Duplicate native dialogs are rejected. Missing-engine startup closes its channels safely and displays a native error. Installer/uninstaller guards require the running app to close before replacing/removing its files. Windows resources include both fixed and string version values.

## Boundaries

The framework is not asserted vulnerability-free. Release 3.0.0 still documents a partly fixed iframe/native-bridge issue; Marx's no-frame policy is an application mitigation. No live Checkmarx tenant, other OS/architecture, physical UNC share, native notification-click interaction, manual OS folder-drop gesture, or disk-corruption recovery was qualified in this pass. Runtime tests cover synthetic behavior and do not replace those integration checks. The installer is unsigned and requires the installed WebView2 runtime. Do not expose acceptance debugging builds or use real credentials in test profiles.

The earlier Electron verification documents are historical. No machine-specific screenshots, detailed runtime logs, user profiles or findings were added to this branch.
