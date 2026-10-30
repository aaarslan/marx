# Building and packaging

Use Bun 1.4.4 with the committed lockfile. Electron includes its own runtime; end users do not need Bun or Node.js.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run audit
```

## Targets

| Command | Target | Output |
| --- | --- | --- |
| `bun run dist:mac` | macOS ARM64 | `Marx-0.5.0-arm64.dmg` and ZIP |
| `bun run dist:win` | Windows x64 | `Marx-0.5.0-win-x64-setup.exe` |
| `bun run dist:win:arm64` | Windows ARM64 | `Marx-0.5.0-win-arm64-setup.exe` |
| `bun run dist:win:dir` | Windows x64 | Unpacked app for inspection |
| `bun run dist:dir` | Current host platform | Unpacked app |

Artifacts are written to the ignored `dist/` directory. Publishing is disabled in the scripts. No CI or GitHub Actions are configured.

Build macOS packages on a Mac. The existing macOS hook ad-hoc signs and verifies the app without a certificate. These builds are not notarized.

Windows NSIS installers have been cross-built on macOS. Building and running them on Windows still requires a Windows-host validation pass. The supported NSIS toolset is pinned to `1.2.1`, which provides a native Apple Silicon compiler; the legacy default toolset requires an Intel Mac runtime. Windows executables retain their icon and version resources, but Authenticode signing is disabled because no certificate is configured. Installers allow a per-user installation and a custom destination. Signing a release for public distribution requires a separate certificate workflow.

## Build design

Main and preload dependencies are bundled and minified. ZIP support lives in a bundled chunk loaded when a scan reaches archiving. Secondary renderer views load on demand; Scan remains mounted so navigating preserves its draft. Production sourcemaps and compiler caches are excluded from packages.

In a local comparison with the same dependency lockfile, combined main JavaScript fell from 578.83 KB to 260.24 KB, with the startup entry at 31.92 KB. The renderer entry fell from 287.68 KB to 250.68 KB. These are emitted uncompressed sizes, not startup-time or download guarantees. Electron itself dominates installer size.

## Validate packages

- On macOS, mount the DMG, copy the app to a temporary directory, then launch that copy with a disposable `MARX_USER_DATA_DIR`. Verify all views, demo findings, shortcuts and single-instance behavior. Verify the bundle with `codesign --verify --deep --strict`.
- Inspect `resources/app.asar` (Windows) or `Contents/Resources/app.asar` (macOS). It should contain bundled application chunks and no `node_modules` tree. Check that deferred ZIP and renderer view chunks are included.
- On a Windows host, install each relevant architecture and verify launch, native frame controls, folder picker and drop, `Ctrl+O`, `Ctrl+R`, persistence, DPAPI credential storage, notifications, exports and uninstall. Cross-building an installer alone does not prove those runtime behaviors.
- Live Checkmarx checks require a real tenant and API key. Mock-service scan checks do not establish live API acceptance.

Version 0.5.0 has been packaged as a macOS DMG/ZIP and Windows x64/ARM64 installers on Apple Silicon. macOS packaged runtime and a mock-service scan have local coverage. Windows native runtime validation remains pending.
