# Dependency maintenance

Marx uses Wails 3.0.0 and Go 1.27.3 for its native desktop host, Bun 1.4.4 for the compiled workflow sidecar, and React/Vite for the interface. Exact frontend versions and integrity data are committed in `package.json` and `bun.lock`; the Go graph is committed in `go.mod` and `go.sum`.

Electron, electron-builder, ASAR, the former packaging patches, and their development dependencies have been removed. Picomatch remains for bounded workspace matching, not application packaging. The TypeScript workflow tests are retained; Electron-specific packaging tests were removed with their consumers.

Use `bun outdated` and `go list -deps` with `go list -m -u` to review updates to modules actually compiled into the host. Upstream Wails' module graph also mentions tooling and platforms not compiled into the Windows executable. Blindly upgrading that entire graph is not equivalent to upgrading runtime dependencies: upstream task aliases and glob consumer APIs can be incompatible. Audit the compiled application and tools separately.

Run `bun audit`, `govulncheck ./native`, and `govulncheck -mode=binary -scan=module dist/Marx.exe`. A clean advisory scan means no findings in that scanner/database snapshot, not proof that every dependency has no defects. Wails 3.0.0's release notes disclose a remaining child-frame/native-bridge limitation that is not reported by the current Go scan. Marx blocks embedded frames and remote content as documented in [SECURITY.md](../SECURITY.md). Do not suppress or describe that limitation as an upstream fix.
