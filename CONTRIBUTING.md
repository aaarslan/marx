# Contributing to Marx

Small, focused pull requests are welcome. Describe the user-visible problem, the change and the checks you ran. For a larger feature, open an issue first so the scope can be discussed.

## Set up

Use macOS on Apple Silicon or Windows and the Bun version in `.bun-version`. macOS packaging requires a Mac; Windows runtime checks require Windows.

```sh
bun install --frozen-lockfile
bun run dev
```

A Checkmarx One API key is only needed for live integration checks. The unit tests and built-in demo work without credentials.

## Check your changes

Run locally before opening a pull request:

```sh
bun run typecheck
bun run test
bun run build
bun run audit
```

For UI changes, inspect the actual Electron app at its minimum 960×640 window size, with keyboard navigation and reduced motion. For dependency or packaging changes, run `bun run verify:packaging`, review [the dependency patches](docs/dependencies.md), and follow [building and packaging](docs/building.md): verify the copied macOS app launches from the DMG, and validate Windows installer changes on Windows. No CI or GitHub Actions configuration is required or included.

Use a disposable directory through `MARX_USER_DATA_DIR` for runtime tests. Keep real credentials and existing app data out of fixtures.

## Project conventions

- Keep changes proportional and reuse the existing components and typed preload API.
- Preserve Checkmarx request contracts. Confirm uncertain changes against the official client and update focused tests and [API documentation](docs/api-contracts.md).
- Handle cancellation, timeouts and bounded work when changing asynchronous flows. Do not retry mutations whose remote outcome is unknown.
- Use synthetic data and reserved example domains in new fixtures. Never include API keys, customer source, real scan results or personal filesystem paths.
- Keep `bun.lock` in sync when dependencies change. Do not introduce a second package-manager lockfile.
- Keep generated app bundles, archives, logs, compiler caches and local tool state out of Git.
- Run checks appropriate to the change and describe any integration behavior you could not verify.

## Pull requests

Include a short explanation and local validation results. UI changes should include screenshots made with sample data. Distinguish fixture-backed checks from real tenant validation; do not claim live acceptance based only on mocks.

For security issues, follow [SECURITY.md](SECURITY.md) instead of posting sensitive details in a public issue.
