# Dependency maintenance

Wails 3.0.0 and Go 1.27.3 provide the desktop and workflow engine. The SQLite driver is modernc.org/sqlite 1.61.1, with modernc.org/libc 1.79.1. Bun 1.4.4 builds and tests the React/Vite frontend; no JavaScript runtime is shipped. Exact frontend versions and integrity data are in `package.json` and `bun.lock`; the Go graph is in `go.mod` and `go.sum`.

Electron, electron-builder, ASAR, their packaging patches, Picomatch/fdir adapters and the Bun workflow sidecar have been removed with their consumers. Workspace matching is bounded Go code. Former TypeScript backend tests have been replaced by native Go tests against an executable Go CLI fixture; frontend/shared TypeScript tests remain.

Use `bun outdated` and `go list -deps` with `go list -m -u` to review modules actually compiled into the application and resource tool. Upstream Wails' graph also names unused tooling and other platforms. Upgrading the entire graph indiscriminately can introduce incompatible task aliases or APIs; inspect the compiled dependency set.

Run `bun audit`, `govulncheck ./native/... ./tools/resources`, and `govulncheck -mode=binary dist/Marx.exe`. These returned no findings during this verification. Advisory databases are snapshots, not proof that dependencies have no defects. Wails 3.0.0's release notes still disclose a partly fixed child-frame/native-bridge issue that the Go scanner does not report. Marx blocks frames and remote resources as documented in [SECURITY.md](../SECURITY.md); this is an application mitigation, not an upstream fix.
