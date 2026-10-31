<div align="center">
  <img src="docs/icon.png" width="88" alt="Marx icon" />

# Marx

**A desktop remediation workbench for Checkmarx One.**

Scan local projects with SAST and SCA, investigate related findings, preserve remediation evidence, and compare verification scans before you push.

![Version](https://img.shields.io/badge/version-0.8.1-ff864d)
![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple_Silicon-17181c?logo=apple&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-x64_%26_ARM64-17181c?logo=windows&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.4.4-17181c?logo=bun&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-ff864d)](LICENSE)

[Features](#features) · [Quick start](#quick-start) · [Development](#development) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

<img src="docs/workbench-results.png" width="960" alt="Marx investigation workbench with saved evidence, filters and split finding detail" />

<sub>The screenshot uses an isolated synthetic CLI fixture, not a customer scan.</sub>
</div>

## Features

| Workflow | What Marx provides |
| --- | --- |
| Scan a project | Browse or drop a folder, detect its Git branch, choose SAST/SCA options and exclusions |
| Follow progress | Durable jobs and logs, recovery of known scans after restart, confirmed cancellation and explicit unknown outcomes |
| Explore findings | Saved filters and investigation context, paged split list/detail, related-fix groups, source freshness and editor links |
| Compare changes | New, persistent, escalated, reduced and absent findings with explicit coverage and provenance checks |
| Track remediation | Pinned baseline evidence, exact finding selections, assistant handoffs, change references, checks and verification records |
| Triage and export | Update states with a comment; export filtered CSV/JSON, official SARIF or a complete remediation evidence bundle |
| Scan multiple projects | Nested workspace discovery, dependency impact hints, exact per-folder project mappings and custom scan options |
| Work comfortably | Keyboard navigation, recent folders, reduced-motion and display accessibility support |

Marx is a standalone GUI for the official Checkmarx One `cx` CLI. It runs your installed CLI for authentication, project discovery, scan submission, monitoring, results and triage. The CLI uploads selected source and analysis runs in Checkmarx One. Marx has no custom upload fallback.

## Quick start

### Requirements

- macOS on Apple Silicon, or Windows x64/ARM64. Windows packages are cross-built; native Windows runtime validation is still pending.
- Your organization’s approved Checkmarx One CLI (`cx`), installed and configured. CLI 2.3.69 is the locally checked contract baseline.
- A Checkmarx One account authorized to run scans. Existing CLI authentication works without saving a second API key in Marx.
- [Bun](https://bun.com/) 1.4.4 to run or package the source.
- Git is optional for branch detection.

Clone this repository, enter its directory, then run:

```sh
bun install --frozen-lockfile
bun run dev
```

1. Open **Settings**, select the same **CLI executable** that works in your terminal (or leave it blank for PATH discovery), keep **Use the CLI’s existing configuration**, and choose **Test CLI connection**. If your command uses a custom configuration file, enter its absolute path. Alternatively, choose **Use an API key saved in Marx**, save your key and connection settings, then test the CLI connection.
2. Open **Scan** and choose a project folder. Check the detected branch, project and exclusions.
3. Choose the exact Checkmarx project. **Run scan** saves the repository mapping and starts the scan. **Story check** runs a full scan and opens Results, where you choose a baseline explicitly.
4. Open **Results** to inspect, compare, triage or export findings. Select **Group by fix** to inspect related dependency updates or shared SAST sinks.
5. Select findings, choose **Fix with AI**, and **Track remediation** to pin the evidence in **Workbench**. Record the change and checks, then run or select a later verification scan. See [the workbench guide](docs/workbench.md).

**Try it without credentials:** open Results and choose **Load demo results**. Sample findings use the normal filters and detail view; demo triage is read-only.

### Build an app

```sh
bun run dist:mac        # macOS ARM64 DMG and ZIP
bun run dist:win        # Windows x64 installer
bun run dist:win:arm64  # Windows ARM64 installer
```

Artifacts appear in `dist/`. On macOS, open the DMG and copy **Marx.app** to Applications. On Windows, run the installer. Bun is not needed to run a packaged app. See [building and packaging](docs/building.md) for host requirements and validation boundaries.

macOS builds are ad-hoc signed and are not notarized. macOS may require approval in **System Settings → Privacy & Security** before the first launch. Only approve a build you produced or otherwise trust.

Windows installers are unsigned. Windows may display an unknown-publisher or SmartScreen warning; use only builds you trust.

### Keyboard shortcuts

| macOS | Windows | Action |
| --- | --- | --- |
| `⌘O` | `Ctrl+O` | Choose a project folder |
| `⌘R` | `Ctrl+R` | Run scan; returns to the Scan view |
| `⌘⇧R` | `Ctrl+Shift+R` | Reload the window |
| `Esc` | `Esc` | Return from a finding to the results list |
| `Alt+↑` / `Alt+↓` | `Alt+↑` / `Alt+↓` | Previous / next finding in the current review |

## Fix findings with your coding assistant

In **Results**, choose **Fix with AI**. Select exact severity levels (Critical and High are selected initially), choose all loaded findings, the current results filters, or the finding you are inspecting, and preview the prompt. Choose **Copy prompt** and paste into Copilot with the affected repository open. **Other coding assistant** provides a provider-neutral template.

Prompts include finding identities, original vendor IDs, CVE/CWE references, dependency paths and recommendations, triage state, locations and full SAST flows. Large selections become numbered batches with independent context. Copy each batch or save all batches as Markdown. Incomplete scans and demo evidence remain clearly labeled. Tracking a remediation pins its original scan separately from the latest cached results, so refreshing or changing triage cannot rewrite that original evidence.

Prompt generation is local and requires no LLM API key. Marx does not send prompts to an assistant or apply fixes automatically. Your coding assistant makes changes in your repository; use a fresh Marx scan to confirm the outcome. See [remediation prompts](docs/remediation-prompts.md) for the format and template extension point.

## How it works

```mermaid
flowchart TD
  A[Scan and batch controls] --> B[Official cx CLI]
  B --> C[Checkmarx One]
  B --> D[Durable jobs and local evidence]
  C --> B
  D --> E[Investigation and remediation sessions]
  E --> F[Verification comparison]
  E --> A
  D --> F
```

Default exclusions omit `.git`, `node_modules` and common build output. Review exclusions before scanning; they can be customized. The CLI handles source packaging and upload. Marx reads JSON reports from a private temporary directory and removes those reports after reading them. Exclusions are translated into CLI filters; default exclusions can be removed explicitly with `!name`.

The **Story check** runs a full scan of the working folder, including uncommitted files. In Results, explicitly select an earlier completed scan of the same project as the baseline. Candidates default to the same branch; enable **Show other branches** to compare across branches deliberately. New or escalated High/Critical findings require attention. A passing verification additionally requires complete evidence, stable finding identities, compatible engine coverage and effective configuration, and qualified source provenance. Missing coverage is shown as inconclusive. An absent finding alone does not establish remediation. The current CLI does not supply all evidence required for a conclusive pass; see [verification boundaries](docs/workbench.md#verification).

See [CLI contracts](docs/api-contracts.md) for command and report formats and [limitations](docs/limitations.md) for current boundaries.

## Scan safeguards

Before authentication in the connection test and before every scan submission, Marx checks local CLI help for required commands and flags. Unsupported capabilities produce an actionable error before upload. This verifies command availability, not tenant permissions or server compatibility.

Repository mappings use the canonical folder path, exact project ID and a fingerprint of CLI configuration and environment. Changed configuration requires confirming the mapping again. Folder names never select existing projects or source folders. Batch scans let you choose and save each exact mapping directly; unbound folders create new projects, and ambiguous existing names are blocked. The CLI resolves the selected name back to its expected ID before submission. Jobs are saved before any upload starts, and recovery never automatically resubmits an uncertain job.

## Privacy and credentials

The official CLI sends source archives and the metadata needed to run a scan to your Checkmarx One tenant and its upload endpoint. Marx does not include analytics or a separate application backend.

Settings and the credential file live in Electron’s per-user application-data directory. When Marx-managed authentication is selected, the saved key is passed only in the child process environment, never in command arguments. Marx does not modify the CLI’s existing credential configuration. Marx-managed keys require Electron `safeStorage` encryption backed by macOS Keychain or Windows DPAPI. If protected storage is unavailable, saving and reading keys is blocked; use native CLI authentication. Legacy plaintext or unreadable keys remain untouched until you explicitly replace or remove them in Settings. See [Security](SECURITY.md) for details.

The local SQLite workbench also stores findings, jobs, bounded logs, source fingerprints, session notes and handoffs. This evidence is not encrypted by Marx; protect the user profile and exported files. **Workbench → Activity** provides explicit cleanup. Active or unresolved jobs and session-referenced evidence are protected from retention pruning.

## Development

The app uses Electron, React, TypeScript and Zustand. Bun handles installation, scripts, tests, typechecking and packaging; Electron retains its own embedded Node.js runtime.

| Command | Purpose |
| --- | --- |
| `bun run dev` | Launch the development app |
| `bun run typecheck` | Check main/preload and renderer TypeScript projects |
| `bun run test` | Run the local Vitest suite |
| `bun run verify:packaging` | Check dependency replacements, file selection and ASAR behavior |
| `bun run build` | Remove previous `dist/` artifacts and compile the application |
| `bun run start` | Preview an existing build |
| `bun run clean:dist` | Remove all distribution artifacts |
| `bun run dist` | Package for the current host platform |
| `bun run dist:dir` | Build an unpacked app for the current host |
| `bun run dist:mac` | Build the ad-hoc-signed macOS ARM64 DMG and ZIP |
| `bun run dist:win` | Build a Windows x64 installer |
| `bun run dist:win:arm64` | Build a Windows ARM64 installer |
| `bun run dist:win:dir` | Build an unpacked Windows x64 app |
| `bun run screenshot` | Capture the real demo UI with a disposable profile |
| `bun run audit` | Check dependencies for known security advisories |

Every build removes the entire previous `dist/` directory before compilation, including installers and unpacked apps for other platforms. All packaging commands inherit this cleanup, so only artifacts from the latest packaging run remain. Verification and screenshot commands also call `build` and clear `dist/`. Source files, configuration and installed applications are unaffected.

```text
src/main/           Electron lifecycle, IPC, scan runners and CLI adapter
src/preload/        Typed, isolated renderer bridge
src/renderer/       React views and shared UI
src/shared/         Models, IPC contracts and verdict rules
tests/              Local unit and regression tests
scripts/            Packaging, screenshots and icon generation
```

Use `MARX_USER_DATA_DIR` with a disposable directory for isolated runtime checks. Do not copy real credentials into test profiles.

Verification is local. No GitHub Actions or other CI configuration is included. [Contributing](CONTRIBUTING.md) describes the checks to run before a pull request.

## Project status

Marx is a young application. Local tests cover CLI arguments, process execution and limits, credential forwarding, reports, normalization, pagination, cancellation, project selection safety, source access, exports and verdicts. `bun run verify:cli` exercises the Electron GUI with an isolated synthetic CLI and no network calls. Live tenant workflows still require end-to-end validation with a real API key. A passing test suite is not proof of every tenant integration or an absence of vulnerabilities.

See [current limitations and validation gaps](docs/limitations.md).

## Acknowledgments

Built with [Electron](https://www.electronjs.org/), [React](https://react.dev/), [electron-vite](https://electron-vite.org/), [Zustand](https://zustand.docs.pmnd.rs/), SQLite through Electron's embedded Node runtime, and [Lucide](https://lucide.dev/). CLI contract research used the official [Checkmarx AST CLI](https://github.com/Checkmarx/ast-cli) source. Interaction refinements were informed by [Emil Kowalski's design engineering skills](https://github.com/emilkowalski/skills).

## License

[MIT](LICENSE) © Marx contributors.

Marx is an independent project and is not affiliated with or endorsed by Checkmarx. Checkmarx is a trademark of its respective owner.
