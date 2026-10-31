# Building and packaging

Use Bun 1.4.4 with the committed lockfile. Electron includes its own runtime; end users do not need Bun or Node.js.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run verify:packaging
bun run build
bun run audit
```

## Targets

| Command | Target | Output |
| --- | --- | --- |
| `bun run dist:mac` | macOS ARM64 | `Marx-0.8.1-arm64.dmg` and ZIP |
| `bun run dist:win` | Windows x64 | `Marx-0.8.1-win-x64-setup.exe` |
| `bun run dist:win:arm64` | Windows ARM64 | `Marx-0.8.1-win-arm64-setup.exe` |
| `bun run dist:win:dir` | Windows x64 | Unpacked app for inspection |
| `bun run dist:dir` | Current host platform | Unpacked app |

Artifacts are written to the ignored `dist/` directory. Publishing is disabled in the scripts. No CI or GitHub Actions are configured.

Build macOS packages on a Mac. The existing macOS hook ad-hoc signs and verifies the app without a certificate. These builds are not notarized.

Windows x64 NSIS installation, packaged launch, synthetic workflows, persistence and uninstallation were verified natively on Windows 11 Pro x64 on October 31, 2026. See [native Windows evidence](native-windows-verification.md) for exact coverage and remaining gaps. Windows ARM64 runtime validation remains pending. The supported NSIS toolset is pinned to `1.2.1`, which provides a native Apple Silicon compiler; the legacy default toolset requires an Intel Mac runtime. Windows executables retain their icon and version resources, but Authenticode signing is disabled because no certificate is configured. Installers allow a per-user installation and a custom destination. Signing a release for public distribution requires a separate certificate workflow.

## Build design

Main and preload dependencies are bundled and minified, including the workspace glob matcher. The official Checkmarx CLI handles scan archives. Secondary renderer views load on demand; Scan remains mounted so navigating preserves its draft. Production sourcemaps and compiler caches are excluded from packages. Packaging uses [version-pinned Picomatch and fdir adaptations](dependencies.md), applied by Bun during installation.

In a local comparison with the same dependency lockfile, combined main JavaScript fell from 578.83 KB to 260.24 KB, with the startup entry at 31.92 KB. The renderer entry fell from 287.68 KB to 250.68 KB. These are emitted uncompressed sizes, not startup-time or download guarantees. Electron itself dominates installer size.

## Validate packages

- On macOS, mount the DMG, copy the app to a temporary directory, then launch that copy with a disposable `MARX_USER_DATA_DIR`. Verify all views, demo findings, shortcuts and single-instance behavior. Verify the bundle with `codesign --verify --deep --strict`.
- Inspect `resources/app.asar` (Windows) or `Contents/Resources/app.asar` (macOS). It should contain bundled application chunks and no `node_modules` tree. Check that renderer view chunks and the report worker are included.
- On a Windows host, install each relevant architecture and verify launch, native frame controls, folder picker and drop, `Ctrl+O`, `Ctrl+R`, persistence, DPAPI credential storage, notifications, exports and uninstall. Cross-building an installer alone does not prove those runtime behaviors.
- Live Checkmarx checks require a real tenant and API key. Mock-service scan checks do not establish live API acceptance.

Version 0.5.0 has been packaged as a macOS DMG/ZIP and Windows x64/ARM64 installers on Apple Silicon. macOS packaged runtime and a mock-service scan have local coverage. Windows x64 native validation is recorded below; Windows ARM64 native runtime validation remains pending.

## Native Windows acceptance

Use PowerShell and Bun 1.4.4. Run `bun run test --pool=threads --maxWorkers=2`; Windows runs 176 tests and intentionally skips ten macOS universal-package cases. `bun run verify:cli` now builds a disposable native mock CLI with Bun; it exercises synthetic data, not a live tenant. The harness clears Electron's inherited `ELECTRON_RUN_AS_NODE` during compilation and saves screenshots in its temporary evidence directory.

After `bun run dist:win`, inspect with `bun run verify:packaging --archive dist/win-unpacked/resources/app.asar`. To run synthetic acceptance against that archive, set `$env:MARX_ACCEPTANCE_BUNDLE = Join-Path $PWD 'dist/win-unpacked/resources/app.asar'` before `bun --bun electron scripts/verify-cli.cjs`. This uses Electron with the packaged application code; separately launch `dist/win-unpacked/Marx.exe` and the installed executable to verify executable startup.

Close Marx before rebuilding: Windows locks running executable files. `dist:win:dir` calls the clean build and removes the previous installer from `dist`; preserve desired artifacts outside that directory before invoking another clean build. Never run the Linux `--package --launch --acceptance` extension on Windows. Use a unique disposable `MARX_USER_DATA_DIR` for executable tests, including installer-launched apps. Uncheck Run Marx in the wizard and launch explicitly with that environment variable to avoid touching the ordinary profile.
