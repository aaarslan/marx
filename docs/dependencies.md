# Packaging dependencies

Marx uses [Picomatch 4.0.7](https://github.com/micromatch/picomatch) for workspace selection and packaging patterns. Workspace matchers are compiled once per bounded selector and bundled into the main process. Packaging uses the same matching engine through four version-pinned Bun patches.

The change removes the npm minimatch implementations associated with [GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249). It also removes application calls to `path.matchesGlob`, which delegates to a bundled minimatch implementation in the current Electron runtime. Electron itself still contains Node's internal libraries; this change does not replace the embedded runtime.

## How the dependency graph is changed

| Package | Adaptation |
| --- | --- |
| `app-builder-lib@26.18.0` | Compile Picomatch patterns explicitly, retain ordered inclusion/exclusion and directory traversal, and replace inspection of Minimatch parser internals. |
| `@electron/asar@3.4.1` | Use Picomatch for unpack patterns and fdir for file enumeration. Preserve file and directory links without following them. |
| `@electron/universal@2.0.3` | Use Picomatch for architecture-specific allowlists in both CommonJS and ESM builds. |
| `dir-compare@4.2.0` | Use Picomatch for the existing include/exclude filters, retaining basename matching for patterns without slashes. |

The root `package.json` combines [Bun patches](https://bun.com/docs/pm/cli/patch), scoped npm alias overrides, and [package extensions](https://bun.com/docs/pm/package-extensions). The patches adapt the actual callers. Package extensions declare their new imports. The overrides change the packages resolved through the old dependency edges: a legacy `minimatch` slot resolves to the real Picomatch release, and ASAR's legacy `glob` slot resolves to fdir. Those historical slot names can therefore still appear in `bun.lock`; the resolved package names and integrity hashes identify the replacement code. Patching a dependency's manifest alone does not remove its original dependency graph.

Two unused dependency chains are removed separately. EJS is pinned to 5.0.2, whose library no longer pulls in Jake and filelist; its compiled MSI template output was checked against the prior version. The Squirrel.Windows peer is marked optional because Marx's Windows installer uses NSIS. Adding Squirrel support later requires an explicit dependency review.

## Pattern contract

New packaging patterns use Picomatch syntax. The patches preserve Marx's configured patterns and electron-builder's generated defaults, including dotfiles, brace alternatives, ordered re-inclusion, extensionless directory patterns and traversal into selected descendants. Basename matching applies only to patterns without path separators. Paths are normalized before matching, and matching remains case-sensitive.

Mapped source paths are compared as literal prefixes. Generated build/output exclusions and universal-archive unpack patterns quote literal filenames, so punctuation such as parentheses, brackets, braces and commas does not change which files are selected. Regression fixtures also check that encoded lookalike filenames retain their own packing status.

Builder patterns are limited to 4,096 characters and 256 comma-brace alternatives, with at most 1,024 directory traversal prefixes and 1 MiB of combined prefix text. Exceeding a limit fails the build explicitly. Positive extglobs containing path separators are rejected; use brace alternatives such as `assets/{icons/small,logos/large}/**` instead. The limits prevent a short configuration from generating an unbounded set of compiled prefix matchers.

ASAR's `globOptions` accepts `dot`, `ignore`, `nodir`, `nosort`, `nocase`, `nobrace`, `noext`, `noglobstar` and `matchBase`. Other provided options fail explicitly. Selection patterns and relative ignores are evaluated from the source directory, so special characters in the source directory name stay literal. Absolute ignore patterns are supported. Symlink entries are retained, their descendants are never traversed, and targets outside the archive are rejected. The patch also fixes absolute-link resolution and uses path-segment containment checks, including Windows drive and UNC paths.

This is a consumer migration, not an implementation of the entire Minimatch or glob 7 API. Review advanced custom patterns and ASAR crawler options when changing the packaging configuration. Do not install a blanket alias without the matching caller patches.

## Verification and upgrades

Use the pinned Bun version and committed lockfile:

```sh
bun install --frozen-lockfile
bun run verify:packaging
bun run typecheck
bun run test
bun run build
bun run audit
```

The packaging checks exercise the real dependency consumers, inspect resolved replacement packages, and check file-selection and archive behavior. Their Windows drive and UNC path cases run portably; they do not establish that Windows installers have run on Windows. Native macOS and Windows release checks remain described in [building and packaging](building.md).

On a Linux development host with Xvfb available when there is no display, run the full local packaging gate:

```sh
bun run verify:packaging --package --launch --acceptance
```

This compiles the application, packages it into a new temporary directory using the installed Electron distribution, checks archive contents against the compiled files, launches the actual executable with a disposable profile, and runs the synthetic CLI workflow against `app.asar`. It does not publish a release or modify the checked-in screenshots. Linux remains a verification host rather than a supported release target.

When updating any patched package, review the upstream changes, regenerate its patch with `bun patch`, update the exact package extension and override scope where necessary, and rerun the checks from a fresh installation. Inspect and launch an actual packaged app before publishing. Remove a patch and its matching metadata together once the upstream dependency no longer needs the adaptation. Keep `bun run audit` enabled; no advisory is ignored by this migration.
