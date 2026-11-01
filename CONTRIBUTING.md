# Contributing to Marx

Focused pull requests are welcome. Describe the user-visible problem, resulting behavior and relevant local checks. Discuss substantial features in an issue before implementing them. Report vulnerabilities through [SECURITY.md](SECURITY.md).

## Set up

Use Go 1.27.3 and Bun 1.4.4, pinned in `.go-version`, `go.mod` and `.bun-version`. The Wails Go module and frontend runtime are pinned together. macOS packaging requires Apple Silicon and Xcode Command Line Tools; Windows runtime acceptance requires Windows 11 x64 with WebView2. NSIS 3.12 is needed for the Windows installer.

```sh
bun install --frozen-lockfile
bun run dev
```

Unit tests and synthetic acceptance do not need a tenant or API key. Follow [building and native verification](docs/building.md) for platform commands, isolated profiles and toolchain overrides.

## Validate your change

```sh
bun run typecheck
bun run test --pool=threads --maxWorkers=2
bun run test:go
go vet ./native/... ./tools/resources
bun run build
bun run verify:packaging
bun run audit
```

Run the native Go race suite when changing concurrency or process handling. For UI changes, exercise the actual WKWebView or WebView2 application at its 960×640 minimum window size, keyboard navigation and reduced motion. Native synthetic acceptance uses a separately compiled acceptance-tagged host; never distribute that binary. A cross-build does not establish runtime acceptance on another operating system.

For dependency changes, also run `bun run audit:go` with govulncheck installed and inspect the compiled dependency graph. A passing dependency audit does not replace the [documented framework security assessment](SECURITY.md).

For website changes, run `bun run verify:site`, preview `website/`, and inspect narrow and desktop layouts, keyboard tabs and video playback. See [website hosting](docs/hosting.md) and [showcase production](showcase/README.md). No GitHub Actions workflow or remote paid validation is required.

Before committing:

```sh
git diff --check
bun run verify:privacy
```

The privacy verifier inspects staged files and available release executables. Review screenshots and media separately. Use a GitHub noreply identity for commits when keeping your personal email private.

## Project conventions

- Reuse the existing typed desktop API and repository components. Keep changes proportional to the problem.
- Keep the official CLI as the scan boundary. Preserve its request contracts and explicit folder-to-project mapping.
- Handle relevant timeouts, cancellation and bounded work. Never retry a mutation with an unknown remote outcome.
- Add focused behavioral coverage for changed contracts and failure paths. Report native, synthetic, cross-built and live checks separately.
- Use synthetic fixtures and reserved example domains. Keep profiles, keys, logs, raw evidence and personal paths outside tracked files.
- Keep `bun.lock` and `go.sum` synchronized with dependency changes. Use the existing package managers and exact pins.
- Keep generated application bundles, temporary render state and tool installations ignored. Public website media is intentionally tracked so hosting needs no render job.
- Keep documentation consistent with the current Wails application. Historical Electron evidence belongs in `docs/archive/`.
- Do not add code comments or docstrings. Preserve required compiler directives and third-party license notices.
- Do not add CI workflows or trigger metered validation without explicit authorization.

## Repository layout

| Path | Purpose |
| --- | --- |
| `native/` | Wails desktop host, Go engine and native tests |
| `src/` | React interface and shared contracts |
| `tests/` | Frontend and shared regression tests |
| `scripts/`, `tools/` | Local build, verification and resource tooling |
| `docs/` | User/developer guides and historical verification |
| `website/` | Public static site and synthetic media |
| `showcase/` | Editable film scenes and original score |
| `build/` | Application icons and packaging inputs |
