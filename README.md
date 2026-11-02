# Marx

A desktop workbench for investigating and remediating Checkmarx One findings.

![Version](https://img.shields.io/badge/version-0.9.0-ff864d)
![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple_Silicon-17181c)
![Windows x64](https://img.shields.io/badge/Windows-x64-17181c)
[![License: MIT](https://img.shields.io/badge/license-MIT-ff864d)](LICENSE)

[Get started](#get-started) · [Walkthrough](docs/walkthrough.md) · [Product website](https://aaarslan.github.io/marx/) · [Showcase video](website/assets/marx-showcase.mp4) · [Documentation](docs/README.md) · [Contributing](CONTRIBUTING.md) · [Support](SUPPORT.md)

<img src="website/assets/detail.webp" width="960" alt="Marx native findings explorer with synthetic findings and a source-flow detail panel" />

Marx helps developers and application security teams move from a scan result to a reviewable change: investigate findings, prepare a focused handoff, and keep the original evidence for comparison after a rescan.

It runs your installed, official Checkmarx CLI through a graphical workflow. The CLI uploads selected source to Checkmarx One for remote analysis. You need your organization's Checkmarx access and approved CLI for real scans. Marx is an independent project, with no affiliation with or endorsement by Checkmarx.

**Current status:** version 0.9.0, developer preview. Build from source; published installers are not available yet. Public demos use synthetic findings. See [platform and security status](#platform-and-security-status) before evaluating it with organizational data.

## What you can do

- Configure SAST and SCA scans with explicit folder-to-project mappings and per-project options.
- Monitor durable jobs, recover known scans after restart, and retain uncertain submission outcomes without automatic resubmission.
- Filter and investigate findings, inspect source flows, group related fixes, and compare selected baselines.
- Enrich explicit CVE findings with opt-in CISA KEV, FIRST EPSS and CVE.org context, while preserving scanner severity.
- Revisit scoped decisions when exploitation evidence changes, with pinned history and review dates.
- Prepare local prompts for your coding assistant, pin original evidence, and record changes and verification results.
- Scan workspace packages and export CSV, JSON, official SARIF, or remediation evidence bundles.

The screenshots and film use synthetic application states captured from a native session and re-rendered for presentation. The film is edited, not a continuous recording or live tenant demonstration. Prompt generation stays local; Marx does not call a model or modify your repository. You choose what to share with a coding assistant and review its changes in your normal development workflow.

## Explore the workflow

| Investigate | Prepare a change | Review the evidence |
| --- | --- | --- |
| [![Synthetic findings explorer](website/assets/results.webp)](docs/walkthrough.md#4-investigate-results) | [![Local remediation prompt with synthetic findings](website/assets/prompt.webp)](docs/remediation-prompts.md) | [![Workbench with synthetic evidence and notes](website/assets/workbench.webp)](docs/workbench.md) |
| Filter findings and inspect available flows. | Preview selected findings before copying a handoff. | Keep pinned evidence, notes and verification results. |

| Start with CVE context | Keep loading states clear |
| --- | --- |
| [![CVE intelligence empty state with aligned watchlist and details panels](website/assets/intelligence-empty.webp)](docs/walkthrough.md#cve-intelligence-and-decision-review) | [![Findings loading state with content placeholders](website/assets/loading.webp)](docs/walkthrough.md#4-investigate-results) |
| Look up an exact CVE and choose which observations to watch. | Content placeholders distinguish a pending read from empty or unavailable evidence. |

Watch the [showcase video](website/assets/marx-showcase.mp4), read its [text transcript](docs/walkthrough.md#showcase-transcript), or follow the [full walkthrough](docs/walkthrough.md).

## Get started

There are no published installers yet. Build on the operating system where you will run Marx. The [full build guide](docs/building.md) covers prerequisites, local installation, updating and troubleshooting.

| Required on both platforms | macOS | Windows |
| --- | --- | --- |
| [Git](https://git-scm.com/downloads), [Go 1.27.3](https://go.dev/dl/), [Bun 1.4.4](https://bun.com/docs/installation) | Apple Silicon, macOS 13 or later, Xcode Command Line Tools | Windows 11 x64 and [Microsoft WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |

Obtain your organization's approved official Checkmarx CLI separately for real scans. You can build Marx and explore its sample results before connecting it. Node, Electron and the Wails CLI are not required.

Clone the source, enter the project directory, and check your tool versions:

```sh
git clone https://github.com/aaarslan/marx.git
cd marx
go version
bun --version
```

The versions must match `.go-version` (`1.27.3`) and `.bun-version` (`1.4.4`). Then use the commands for your platform.

### macOS

Install Xcode Command Line Tools with `xcode-select --install` if they are missing, then:

```sh
bun install --frozen-lockfile
bun run dist:mac
bun run start
```

The application is `dist/Marx.app`. To keep a local installed copy, quit Marx and copy the whole app bundle to your Applications folder. This local build is ad hoc signed and not notarized.

### Windows

In PowerShell, from the project directory:

```powershell
bun install --frozen-lockfile
bun run build
bun run start
```

The application is `dist\Marx.exe`; you can also open it in File Explorer. To create a per-user installer, additionally install [NSIS 3.12](https://nsis.sourceforge.io/Download), quit Marx, and run `bun run dist:win`. NSIS is not needed to build or run the standalone executable. Windows outputs are unsigned.

### Connect and use

1. Open **Settings**, select the official CLI and optional configuration file, and choose **Save connection and test**. Existing CLI authentication is the default.
2. Choose a source folder, confirm its Checkmarx project, and review the scan options before upload.
3. Open **Results** to investigate findings, prepare a handoff, or track remediation in **Workbench**.

Command+O / Ctrl+O selects a folder. Command+R / Ctrl+R starts the configured scan; these global actions stay blocked while a prompt or decision dialog is open. Follow [the walkthrough](docs/walkthrough.md) for the complete workflow.

`bun run start` opens the existing build. After source changes, **quit every running copy**, rebuild, and reopen it; a running process keeps its old interface. `bun run dev` rebuilds once and opens the result. It is not a live-reload server. If you copied the app elsewhere, replace that copy with the rebuilt output too.

## Platform and security status

Marx uses Wails 3.1.0, Go, SQLite and React with the system webview. No Bun, Node or Electron runtime is distributed.

| Platform | Current status |
| --- | --- |
| macOS Apple Silicon | Native synthetic workflow and locally built app verified; ad hoc signed, without notarization |
| Windows 11 x64 | Native synthetic acceptance, race checks and isolated install/uninstall passed; Results layout fixes passed Windows acceptance and bounded production checks. The newest Results workspace-save repair awaits Windows follow-up. See [exact revisions and remaining gaps](docs/final-acceptance.md). |

Linux, Intel macOS and Windows ARM64 are outside the supported targets. Windows packages are unsigned. Synthetic checks do not establish live tenant acceptance. See [current limitations](docs/limitations.md) and the [final acceptance checklist](docs/final-acceptance.md) for evaluation boundaries.

Optional saved keys use Windows DPAPI or macOS Keychain-backed encryption. Local evidence and exports can contain sensitive information; the SQLite database is not encrypted. Public intelligence lookups are optional and send only CVE IDs where required. Marx has no analytics service. The Wails child-frame bridge boundary remains documented alongside application mitigations in [SECURITY.md](SECURITY.md).

## Development

```sh
bun run typecheck
bun run test --pool=threads --maxWorkers=2
bun run build
bun run test:go
bun run verify:site
bun run audit
```

[Contributing](CONTRIBUTING.md) covers native acceptance, packaging, privacy checks and project conventions. Keep real scan data and credentials out of issues and pull requests; use [private security reporting](SECURITY.md) for vulnerabilities.

## Participate

Start with [Contributing](CONTRIBUTING.md) for setup and local validation. Useful contributions include reproducible bug reports, clearer onboarding, sanitized CLI compatibility cases, accessibility feedback and native platform verification. Check existing [issues](https://github.com/aaarslan/marx/issues) before opening a proposal.

For help, use [Support](SUPPORT.md). For evaluation and collaboration, see [Project status and collaboration](docs/project-status.md), including the remaining release work and ways organizations can contribute. Security reports belong in the [private reporting channel](SECURITY.md).

## License

Marx is [MIT licensed](LICENSE). Checkmarx services and the official CLI have their own licensing. See [CVE intelligence](docs/cve-intelligence.md), [third-party notices](THIRD_PARTY_NOTICES.md), [dependency maintenance](docs/dependencies.md) and [showcase sources](showcase/README.md) for tooling and media details.
