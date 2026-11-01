# Building Marx with Wails

Marx targets native Windows x64 and macOS Apple Silicon with Wails 3.1.0 and Go 1.27.3. Go implements the scan engine, SQLite workbench, CLI process management, credentials and desktop integration. React runs in system WKWebView on macOS and the installed Microsoft WebView2 runtime on Windows. Bun 1.4.4 is a frontend build/test tool only; it is not distributed.

## macOS

Install Go 1.27.3, Bun 1.4.4 and Xcode Command Line Tools. Build natively on Apple Silicon:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test --pool=threads --maxWorkers=2
bun run dist:mac
go test -race -p=2 ./native/... -count=1 -timeout=5m
go vet ./native/... ./tools/resources
bun run verify:packaging
bun run audit
bun run start
```

The output is `dist/Marx.app`, built for the host architecture with a macOS 13 minimum matching Go's requirement. The build uses the existing icon, embeds frontend assets, and ad hoc signs the bundle. It is suitable for local use; Developer ID signing, notarization, Intel Macs and distribution on other Macs remain unqualified. The build does not use an Apple signing account.

The default profile is `~/Library/Application Support/MarxWails`. Set `MARX_USER_DATA_DIR` to a disposable directory for testing. API-key files use authenticated AES-GCM encryption with a random Keychain entry per saved credential, bound to the canonical profile. Valid credentials from the previous format remain readable. Availability checks do not create encryption keys. Locked or denied Keychain access fails closed. Ad hoc executable replacement or relocation can make a previous entry inaccessible. Native tests verified prompt-free failure and explicit recovery: replace the saved API key in Settings, or remove it and save it again. Replacement allocates a new Keychain entry before atomically committing the file; failed commits retain the old credential. Using the CLI's existing authentication avoids application-managed credential storage. No existing Keychain access controls are changed. Marx disables legacy Keychain authorization dialogs within its own process so denied access returns an error instead of blocking a service call. This uses the deprecated legacy interaction API because `LAContext.interactionNotAllowed` does not suppress file-based Keychain authorization.

CLI commands run in separate process groups. Cancellation kills the group; a copy of the same executable watches a parent-owned pipe and kills remaining descendants when the app exits or crashes. No extra executable is bundled. The macOS menu bar and Command+O/Command+R use native modifier conventions.

To run the synthetic workflow in real WKWebView:

```sh
go build -race -trimpath -buildvcs=false -tags production,acceptance -ldflags '-extldflags=-mmacosx-version-min=13.0' -o /tmp/Marx-acceptance ./native
MARX_TEST_EXECUTABLE=/tmp/Marx-acceptance bun run verify:runtime
```

The macOS harness uses a token-authenticated loopback evaluation transport compiled only with the acceptance tag. CSP remains enabled. Never distribute acceptance binaries. The regular packaging verifier rejects binaries containing the acceptance endpoint. The Windows harness continues to use WebView2 debugging. Set `MARX_VERIFY_MINIMUM_SIZE=1` when running either platform harness to exercise the 960×640 minimum window and toolbar alignment.

## Prerequisites

- Windows 11 x64 with WebView2.
- Go 1.27.3 and Bun 1.4.4 on PATH.
- NSIS 3.12; set `NSIS_EXECUTABLE` if makensis is not on PATH.
- An organization-approved official Checkmarx CLI for real scans. Marx does not download it.

`GO_EXECUTABLE` can select the Go executable for build scripts without committing a local path. Go tests and govulncheck also require the toolchain on PATH. The Wails CLI is unnecessary; `tools/resources` generates Windows resources.

Run natively in PowerShell:

```powershell
bun install --frozen-lockfile
bun run typecheck
bun run test --pool=threads --maxWorkers=2
bun run build
go test -p=2 ./native/... -count=1
go vet ./native/... ./tools/resources
bun run verify:packaging
bun run audit
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./native/... ./tools/resources
bun run dist:win
bun run dist:win:dir
```

Outputs are `dist/Marx.exe` and `dist/Marx-0.9.0-win-x64-setup.exe`. The NSIS payload contains one application executable and its uninstaller. Frontend assets and the pure-Go SQLite driver are embedded. No Bun, Node, Electron, workflow sidecar, report-worker executable, source files or test fixtures are included. The installer runs per user, offers a destination picker, and retains application data on uninstall. Close Marx before installing or uninstalling. Builds are unsigned.

## Runtime and storage

The Go engine invokes the selected CLI directly with argument arrays, bounded concurrency/output, cancellation and timeouts. Windows job objects remove CLI descendants after host termination. Result parsing runs in Go goroutines. Credentials use DPAPI directly inside the application; there is no credential helper process or pipe protocol. There is no application network listener in production.

The profile is `%APPDATA%/MarxWails`, overridable with `MARX_USER_DATA_DIR`. WebView2 data is isolated in that profile's `webview2` directory, including for acceptance profiles. This branch intentionally uses a new SQLite schema. Electron data and the earlier Bun prototype database are not migrated. Unsupported or corrupt databases are rejected and left in place; use a fresh disposable profile for verification.

## Native acceptance

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
