# Building Marx with Wails

Marx targets native Windows x64 with Wails 3.0.0 and Go 1.27.3. Go implements the scan engine, SQLite workbench, CLI process management, credentials and desktop integration. React runs in the installed Microsoft WebView2 runtime. Bun 1.4.4 is a frontend build/test tool only; it is not distributed.

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

Optional harness checks use `MARX_VERIFY_UNC=1` for the existing loopback administrative SMB share, `MARX_VERIFY_EDITOR=code` to request an installed VS Code protocol launch, and `MARX_VERIFY_NOTIFICATIONS=1` to require successful native notification submission. These do not configure shares or Windows notification preferences. The editor window and visible toast/click behavior require separate observation.

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
