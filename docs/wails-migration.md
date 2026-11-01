# Wails and Go engine verification

Verified natively on Windows 11 x64 on October 31, 2026, on `feature/wails-desktop` for PR #4. All workflow data and credentials were disposable and synthetic. No live Checkmarx tenant scan is claimed.

## Shipped architecture

`Marx.exe` contains the Wails 3.0.0 desktop host, complete Go 1.27.3 scan/workbench engine, modernc.org/sqlite 1.61.1 and embedded React assets. Bun is used only to build/test the frontend. The Bun workflow executable, pipe protocol, credential helper, JavaScript report worker, Electron/ASAR dependencies and workspace Picomatch dependency are removed. The synthetic CLI fixture is Go and is never packaged.

Go owns CLI discovery, capability checks, environment-based authentication, project validation, scan arguments, submission/monitoring/cancellation, bounded report imports, normalization, provenance, workspace planning, batch settings, SQLite persistence, pinned remediation evidence, comparison, notes, handoffs, verification and exports. Windows DPAPI runs directly in process. CLI descendants are contained in Windows job objects. Production builds expose no acceptance debug port.

## Executed checks

| Validation | Result and evidence |
| --- | --- |
| Native Windows x64 | All application builds, commands and GUI checks ran natively in PowerShell/Windows executables |
| Frozen installation | Passed; 96 resolved packages, no changes on the frozen installation |
| TypeScript | Both compiler projects passed |
| Frontend/shared regression suite | 41 tests passed across seven files |
| Native Go regression suite | 33 top-level tests passed with the native race detector, including workflow subtests; executable CLI fixture, malformed/oversized reports, remote outcomes, shared imports/cancellation, capacity limits, source containment, nested workspaces, batch cancellation/options, evidence pinning, retention and database rejection |
| Go vet | Passed for application, engine and resource tool |
| Fresh dependency audits | Bun: zero findings across 95 checked packages; govulncheck source/resource-tool and production binary: no vulnerabilities found |
| Dependency currency | No frontend updates from `bun outdated`; compiled Go modules checked for available updates; SQLite and libc updated to their latest resolved releases |
| Packaging | Windows AMD64 PE32+; embedded lazy views; only one application executable in NSIS; no Bun sidecar, source or test fixture payload |
| Native WebView acceptance | Passed all views, CLI capabilities/authentication, scan submission/monitoring/events, complete 5,051-finding import, 100-row GUI paging, sessions/notes, JSON export, inconclusive verification and uncertain cancellation |
| Crash recovery | Known scan ID recovered to Completed without resubmission; uncertain submission stayed Unknown; CLI child did not survive host termination |
| Additional failure coverage | Interrupted WAL snapshot with an incomplete tail recovered committed evidence and discarded uncommitted writes; actual SQLite FULL error rolled back notes/evidence atomically; disposable Windows read-deny ACL blocked source access |
| Race-instrumented GUI | Native acceptance completed with Go's race detector and no reported race, including while a separate production profile was open |
| Frame restrictions | Actual WebView rejected same-origin, remote and srcdoc frames and remote scripts through CSP; injected frame marker did not execute |
| Source integrations | User-assisted physical Explorer folder drop passed; loopback SMB/UNC source read and scan passed; actual installed VS Code opened the synthetic Unicode source at line 1 |
| Desktop notifications | Removed at the user's request after visible delivery could not be established; the service, activation route and go-toast dependency are absent; in-app status and result navigation remain |
| Production executable GUI | Launched outside repository working directory; restored results and finding details; folder picker through Ctrl+O; synthetic scan through Ctrl+R and button; native evidence bundle saved and read back |
| Window/layout controls | Single-instance activation, maximize, restore, minimize and shutdown passed; actual window resized to the configured 960×640 minimum; results remained accessible |
| Native credentials/clipboard | Actual DPAPI encryption and decryption through a disposable CLI credential; plaintext absent from credential blob; generated remediation prompt copied and read back |
| Installed application | NSIS exit 0; installed file matched release build; launched from a temporary working directory; filtered to finding 5,051; generated/copied a prompt; scanned successfully; saved notes survived restart and reinstall |
| Uninstallation | Exit 0; application/uninstaller and uninstall registration removed; zero Marx processes remained; disposable database retained as intended |
| Privacy | Public record uses portable paths only; profiles, detailed logs, screenshots and hardware inventory are not committed; staged files and release binaries checked for local home paths |

The earlier 161 TypeScript tests included the removed backend. They are not reported as current Go coverage; native Go tests replace those consumers, while frontend/shared tests remain. The original Electron packaging contracts are obsolete because ASAR and its patched consumers are no longer shipped.

## Tested artifacts

- Unpacked executable: `dist/Marx.exe` — 15,497,728 bytes.
- Installer: `dist/Marx-0.9.0-win-x64-setup.exe` — 5,110,466 bytes.
- Installed executable: `%LOCALAPPDATA%/Programs/MarxWails/Marx.exe`.
- Disposable profile: `%TEMP%/marx-wails-test-<generated>/profile`.
- Native evidence exports stayed inside the disposable fixture; no raw exported evidence is published.

SHA-256:

```text
Marx.exe
569A4C9476C83F7D471FABB76FB1C9542C1D1624D948E1E29F2B267E150B7152
Marx-0.9.0-win-x64-setup.exe
F9F2721098CB307C3E82487AF5900A1757AD0AE5BD20B270F44A2C82BA56FCED
```

The installer is approximately 5.1 MB, versus approximately 45.6 MB for the earlier Wails/Bun prototype. WebView2's shared installed runtime and the separately supplied Checkmarx CLI are excluded from these sizes.

The production GUI and install/reinstall/uninstall scenarios above were completed before desktop notifications were removed. These final artifacts were rebuilt after removal and passed native acceptance, regression, packaging and audit checks. The installer scenarios were not repeated after that removal.

## Defects fixed during this port

The selected project identity now survives streamed CLI responses; a returned scan in another project requests cancellation rather than overwriting the selection and passing validation. A report missing its results field is rejected even if it claims zero findings; an explicit null slice is accepted only with an explicit zero total. Shared import cancellation does not strand an immediate retry on an aborted task. CLI stderr progress is streamed while structured stdout stays parseable. Queued batch cancellation prevents upload, and per-package options remain distinct. Shutdown waits for admitted operations before closing SQLite. Source reads use rooted filesystem access. Downloads resolves through the Windows known-folder API.

A release-GUI check exposed inconsistent Ctrl+R handling with focus in the branch input. Shortcuts now route through a capture-phase renderer handler with duplicate native bindings removed and repeat suppression. Actual keyboard typing followed by Ctrl+R created and completed one new scan in the final installed app. Ctrl+O also opened the native folder picker.

The branch hint now sits below its input so project and branch controls align in both existing/new project modes; both were inspected in the actual release GUI. A simultaneous production/acceptance run initially timed out with Wails' shared default WebView directory; WebView data now lives inside each selected profile. The race-instrumented acceptance run then passed while a production profile was open.

Desktop notifications were subsequently removed at the user's request. Native submission and Windows history did not establish visible delivery, and clicking a notification never passed verification. The service, send calls, activation event/renderer route and go-toast dependency are removed. Scan progress, saved diagnostics and explicit result navigation remain in the application. The notification-only regression test was removed, leaving 33 native tests.

## Remaining boundaries

Wails 3.0.0 still discloses a partly fixed child-frame/native-bridge vulnerability; Marx's frame/remote-resource restrictions mitigate the application's exposure but are not an upstream patch. No framework-wide vulnerability-free claim is made. See [SECURITY.md](../SECURITY.md).

Live tenant integration, remote NAS authentication/network failure behavior, Cursor, full accessibility certification and arbitrary damaged-page repair remain unqualified. SQLite FULL was induced with a page limit rather than exhausting a physical disk. Corrupt/newer databases were tested for safe rejection; committed/WAL persistence, interrupted-tail recovery and restart were tested. Desktop notifications are outside the product's scope. No other operating system or architecture was built or qualified. The installer remains unsigned. See [limitations](limitations.md).

## macOS validation, November 1, 2026

The PR now builds an ad hoc signed Apple Silicon app bundle using system WKWebView. Native fixes cover CLI discovery and executable validation, profile-scoped Keychain-backed AES-GCM credentials, process-group cancellation and host-crash cleanup, Unix environment/path identity, Command shortcuts and window controls. Recovery begins after the native window runtime is ready; the race detector caught and verified this startup correction. Resumed jobs clear their terminal timestamps before asynchronous monitoring starts.

The macOS run passed 42 frontend/shared tests, both TypeScript projects, the native Go race suite, Go vet, Bun audit, govulncheck, packaging/signature and privacy checks. A Windows x64 cross-compile passed; Windows runtime checks were not repeated on this Mac. Native synthetic WebView acceptance passed scans/events, 5,051 imported findings, paging, encrypted credential round trips, notes/exports, CSP probes, cancellation, persistence/restart without resubmission and CLI cleanup after forced host termination. The full workflow also passed with the native race detector after the startup fix.

The production bundle was inspected using disposable synthetic data. The Results toolbar buttons now match the dropdown's height and vertical edges. The minimum-size native layout was measured, including WebKit's one-pixel window rounding. This is local macOS qualification, without live tenant scans, Developer ID signing, notarization, Intel Mac testing or accessibility certification.

## Credential and process-containment hardening

Follow-up macOS checks exercised malformed/missing Keychain entries, legacy credential compatibility, tampered ciphertext, profile isolation, serialized replacement, failed-write preservation and cleanup. Real executable replacement with different binary bytes and relocation were exercised using disposable credentials. Access can be denied after an ad hoc rebuild; the final app returned a prompt-free error and recovered through an explicit replacement. Automatic credential continuity across differently signed releases is not qualified. The app never changes Keychain ACLs or stores plaintext credentials. Availability probes no longer allocate keys. Legacy file-based Keychain authorization requires a process-local noninteractive setting in addition to `LAContext`.

The native Go race suite and the complete native WebView workflow passed, including missing-entry recovery. Both TypeScript projects, 42 frontend/shared tests, native vet checks, Bun audit, govulncheck, packaging/signature and privacy checks passed. Independent review reported no blocking defects; the defensive findings were repaired and affected checks passed.

Windows CLI creation now uses `CREATE_SUSPENDED`, assigns the job, verifies the primary thread identity and resumes it. Application and regression suites cross-compile for Windows x64, and Windows-targeted vet checks pass. The Windows-native test for immediate child creation and job cleanup was added but could not be run on this Mac. A host crash before job assignment can still leave a suspended root process; it cannot execute CLI user code or create descendants during that interval. Live tenant scans and signed/notarized distribution remain outside this verification.
