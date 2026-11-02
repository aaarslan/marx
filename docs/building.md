# Building Marx with Wails

Marx targets native Windows x64 and macOS Apple Silicon with Wails 3.1.0 and Go 1.27.3. Go implements the scan engine, SQLite workbench, CLI process management, credentials and desktop integration. React runs in system WKWebView on macOS and the installed Microsoft WebView2 runtime on Windows. Bun 1.4.4 is a frontend build/test tool only; it is not distributed.

[Prerequisites](#prerequisites) · [macOS](#macos) · [Windows](#windows) · [Updating a local build](#updating-a-local-build) · [Troubleshooting](#troubleshooting) · [Local validation](#local-validation)

There are no published installers yet. Build from a trusted source checkout on the target operating system. A macOS build does not produce a Windows installer or establish Windows runtime compatibility.

## Prerequisites

| Tool or requirement | macOS | Windows |
| --- | --- | --- |
| Target system | Apple Silicon, macOS 13 or later | Windows 11 x64 |
| Source checkout | [Git](https://git-scm.com/downloads) | [Git](https://git-scm.com/downloads) |
| Go | [1.27.3](https://go.dev/dl/) | [1.27.3](https://go.dev/dl/) |
| Bun | [1.4.4](https://bun.com/docs/installation) | [1.4.4](https://bun.com/docs/installation) |
| Native webview | System WKWebView | [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |
| Build tools | Xcode Command Line Tools | No C compiler needed for the normal build |
| Installer creation | Not available as a signed installer | [NSIS 3.12](https://nsis.sourceforge.io/Download), only for `dist:win` |

For real scans, obtain the official Checkmarx CLI and tenant access through your organization. Marx does not download the CLI or provide an account. Building and opening the sample Results view does not require Checkmarx credentials. Node, Electron and the Wails CLI are not required.

Clone the project and confirm the tool versions in a new terminal:

```sh
git clone https://github.com/aaarslan/marx.git
cd marx
go version
bun --version
```

Use Go `1.27.3` and Bun `1.4.4`, matching `.go-version` and `.bun-version`. Every following command runs from this project directory. If a tool is not found after installation, reopen your terminal and check its PATH setup.

`GO_EXECUTABLE` can select the Go executable for build scripts without committing a machine-specific path. Direct Go commands still require Go on PATH. `NSIS_EXECUTABLE` can select `makensis` for installer creation. Do not commit either local path.

## macOS

Check Xcode Command Line Tools with `xcode-select -p`. If they are missing, run `xcode-select --install` and finish that installer before continuing. Then build natively on Apple Silicon:

```sh
bun install --frozen-lockfile
bun run dist:mac
bun run start
```

The output is `dist/Marx.app`, built for the host architecture with a macOS 13 minimum matching Go's requirement. The build uses the existing icon, embeds frontend assets, and ad hoc signs the bundle. It is suitable for local use; Developer ID signing, notarization, Intel Macs and distribution on other Macs remain unqualified. The build does not use an Apple signing account.

You can open the app bundle from Finder. To keep an installed copy, quit Marx and copy the whole `dist/Marx.app` bundle to your Applications folder. A later rebuild updates `dist/Marx.app`, not any copied installation. Keep the preview's signing limitations visible when sharing it.

### macOS runtime and acceptance details

The default profile is `~/Library/Application Support/MarxWails`. Set `MARX_USER_DATA_DIR` to a disposable directory for testing. API-key files use authenticated AES-GCM encryption with a random Keychain entry per saved credential, bound to the canonical profile. Valid credentials from the previous format remain readable. Availability checks do not create encryption keys. Locked or denied Keychain access fails closed. Ad hoc executable replacement or relocation can make a previous entry inaccessible. Native tests verified prompt-free failure and explicit recovery: replace the saved API key in Settings, or remove it and save it again. Replacement allocates a new Keychain entry before atomically committing the file; failed commits retain the old credential. Using the CLI's existing authentication avoids application-managed credential storage. No existing Keychain access controls are changed. Marx disables legacy Keychain authorization dialogs within its own process so denied access returns an error instead of blocking a service call. This uses the deprecated legacy interaction API because `LAContext.interactionNotAllowed` does not suppress file-based Keychain authorization.

CLI commands run in separate process groups. On macOS, a parent-owned launch pipe prevents CLI execution until the crash guard is ready; owner exit before release closes the pipe without launching the CLI. The gated process execs the selected CLI under the same protected process identity. Cancellation kills the group; a copy of the same executable watches a parent-owned pipe and kills remaining descendants when the app exits or crashes. No extra executable is bundled. The macOS menu bar and Command+O/Command+R use native modifier conventions.

To run the synthetic workflow in real WKWebView:

```sh
go build -race -trimpath -buildvcs=false -tags production,acceptance -ldflags '-extldflags=-mmacosx-version-min=13.0' -o /tmp/Marx-acceptance ./native
MARX_TEST_EXECUTABLE=/tmp/Marx-acceptance bun run verify:runtime
```

The macOS harness uses a token-authenticated loopback evaluation transport compiled only with the acceptance tag. CSP remains enabled. Never distribute acceptance binaries. The regular packaging verifier rejects binaries containing the acceptance endpoint. The Windows harness continues to use WebView2 debugging. Set `MARX_VERIFY_MINIMUM_SIZE=1` when running either platform harness to exercise the 960×640 minimum window and toolbar alignment.

## Windows

Install WebView2 Runtime if it is missing, then run natively in PowerShell:

```powershell
bun install --frozen-lockfile
bun run build
bun run start
```

The output is `dist\Marx.exe`, which you can also open from File Explorer. NSIS is not required for this standalone build. The build generates Windows resources through `tools/resources`; the Wails CLI is unnecessary.

For a per-user installer, install NSIS 3.12, make `makensis` available on PATH or set `NSIS_EXECUTABLE`, quit Marx, and run:

```powershell
bun run dist:win
```

The installer is `dist\Marx-0.9.0-win-x64-setup.exe`. It offers a destination picker and retains application data on uninstall. Close Marx before installing, upgrading or uninstalling. Windows outputs are unsigned. `bun run dist:win:dir` rebuilds the standalone executable without creating an installer.

Frontend assets and the pure-Go SQLite driver are embedded. No Bun, Node, Electron, workflow sidecar, report-worker executable, source files or test fixtures are distributed.

## Updating a local build

Quit every running Marx copy before rebuilding. A process that is already running keeps its earlier interface and behavior; opening the same profile can bring that window forward instead of starting the new binary.

| Command | Behavior |
| --- | --- |
| `bun run start` | Opens the existing `dist` executable; it does not rebuild |
| `bun run build` | Rebuilds for the host platform without launching |
| `bun run dev` | Rebuilds once and launches; it is not a live-reload server |
| `bun run dist:mac` | Builds the local macOS app bundle |
| `bun run dist:win` | Builds the Windows executable and NSIS installer |

After obtaining updated source, rerun `bun install --frozen-lockfile`, rebuild, and reopen the result. Replace any app copied outside `dist`, or run the newly built Windows installer. Existing CLI authentication remains the simplest way to avoid app-managed key replacement issues; [credential replacement verification](#credential-replacement-verification) explains those boundaries.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| `bun`, `go` or `makensis` is not found | Check the required version, PATH and optional executable override; reopen the terminal after installing tools |
| Native Go build says `frontend/dist` is missing | Run `bun run build` first; the Go host embeds the generated frontend |
| macOS compiler or SDK error | Confirm `xcode-select -p` works and the Xcode Command Line Tools installation completed |
| Windows app opens blank or fails before rendering | Confirm WebView2 Runtime is installed; check the [support guide](../SUPPORT.md) before changing system settings |
| The old interface still appears | Quit every running copy, rebuild, and open the output you just built; replace any copied installation |
| Official Checkmarx CLI not found | In Settings, select the approved executable and use **Save connection and test**; Marx does not install it |
| Saved API key becomes unavailable after replacement | Replace it through Settings or choose the CLI's existing authentication; preserve the original profile |

## Local validation

These checks are separate from the quick build. Run the build before native tests because the host embeds generated frontend assets:

```sh
bun run typecheck
bun run test --pool=threads --maxWorkers=2
bun run build
go test -p=2 ./native/... -count=1 -timeout=5m
go vet ./native/... ./tools/resources
bun run verify:packaging
bun run verify:site
bun run verify:privacy -- --all
bun run audit
```

For macOS race coverage, also run `go test -race -p=2 ./native/... -count=1 -timeout=5m`. Windows race coverage needs the separate C-toolchain setup below. `bun run audit:go` is optional vulnerability analysis and requires `govulncheck` installed separately; it is not needed to build Marx.

## Runtime and storage

The Go engine invokes the selected CLI directly with argument arrays, bounded concurrency/output, cancellation and timeouts. Windows job objects remove CLI descendants after host termination. Result parsing runs in Go goroutines. Credentials use DPAPI directly inside the application; there is no credential helper process or pipe protocol. There is no application network listener in production.

The profile is `%APPDATA%/MarxWails`, overridable with `MARX_USER_DATA_DIR`. WebView2 data is isolated in that profile's `webview2` directory, including for acceptance profiles. This branch intentionally uses a new SQLite schema. Electron data and the earlier Bun prototype database are not migrated. Unsupported or corrupt databases are rejected and left in place; use a fresh disposable profile for verification.

## Native acceptance

After removing generated output, run `bun run build` before native Go tests or acceptance-host compilation. The Go host embeds `native/frontend/dist`, so a clean checkout without those generated assets cannot compile the native package yet.

```powershell
$testExe = Join-Path $env:TEMP 'Marx-test.exe'
go build -trimpath -buildvcs=false -tags 'production,acceptance' -ldflags '-s -w -H windowsgui' -o $testExe ./native
$env:MARX_TEST_EXECUTABLE = $testExe
bun run verify:runtime
```

The harness compiles a synthetic Go CLI and creates a private temporary profile. Only acceptance-tagged builds enable the local WebView debugging port; never distribute them. The production executable must also be launched and interacted with, installed through NSIS, reopened with its disposable profile, and uninstalled. Build logs do not establish GUI acceptance.

Optional harness checks use `MARX_VERIFY_UNC=1` for the existing loopback administrative SMB share and `MARX_VERIFY_EDITOR=code` to request an installed VS Code protocol launch. These do not configure shares. The editor window requires separate observation. Desktop notifications are not included; scan status, diagnostics and result navigation stay inside the application.

For native race-detector checks, configure a Windows x64 MinGW-compatible C compiler in the current PowerShell session. The verification used the official portable LLVM-MinGW UCRT release `20261020`, without installing it globally or shipping it:

```powershell
$env:CGO_ENABLED = '1'
$env:CC = (Get-Command clang.exe).Source
$env:GOMAXPROCS = '2'
go test -race -p=2 ./native/... -count=1 -timeout=5m
go build -race -trimpath -buildvcs=false -tags 'production,acceptance' -ldflags '-H windowsgui' -o $testExe ./native
$env:MARX_TEST_EXECUTABLE = $testExe
bun run verify:runtime
```

Keep race/acceptance builds private. Restore session environment overrides before making release builds.

Native Windows 11 x64 verification on October 31, 2026 includes the Go workflow suite, 5,051-finding WebView acceptance, actual release GUI interaction, native folder/save dialogs, DPAPI, installed scanning, persistence and uninstall. Exact results and boundaries are recorded in [the migration report](wails-migration.md).

Keep profiles, detailed logs, screenshots, customer evidence, local account paths and hardware inventories outside tracked files and PR descriptions. Publish only portable summaries. Go builds use `-trimpath -buildvcs=false`; run `bun run verify:privacy` after staging and before committing.

## Credential replacement verification

The macOS runtime harness can replace its private copy of the executable while keeping the same disposable profile. Build two acceptance binaries with different bytes (for example, one with `-s -w` and one without), then set `MARX_UPGRADE_TEST_EXECUTABLE` alongside `MARX_TEST_EXECUTABLE`. The harness checks saved credential access after replacement and tests explicit recovery if macOS denies access. `MARX_UPGRADE_RELOCATE=1` exercises moving the app to another path. The input binaries and real profiles are never overwritten.

Windows guarded CLI commands now start suspended, enter their kill-on-close job object, and resume only after the primary thread's owner has been verified. This prevents CLI user code from spawning a descendant before assignment. Cross-compilation of both application and regression test binaries passed on macOS. The native regression test passed on Windows on November 1, 2026:

```powershell
go test ./native -run '^TestWindowsCLIStartsInsideJobBeforeSpawningChildren$' -count=1
```

This test verifies the CLI cannot execute before job assignment and that closing the job terminates a child spawned immediately after resumption. The separate native runtime acceptance results are recorded in the migration report. A host crash before assigning the newly created suspended process remains a narrow startup boundary; that process has not executed CLI code or spawned descendants.

## Public CVE intelligence verification

Normal tests remain offline. The acceptance build contains a separately gated synthetic intelligence adapter; production packaging rejects that adapter. To explicitly contact the three public sources for one known public CVE, run the opt-in command in [CVE intelligence](cve-intelligence.md#bounds-and-verification). This requires no Checkmarx credentials and does not upload repository contents.
