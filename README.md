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

The screenshots and film use synthetic findings from the native application. Prompt generation stays local; Marx does not call a model or modify your repository. You choose what to share with a coding assistant and review its changes in your normal development workflow.

## Explore the workflow

| Investigate | Prepare a change | Review the evidence |
| --- | --- | --- |
| [![Synthetic findings explorer](website/assets/results.webp)](docs/walkthrough.md#4-investigate-results) | [![Local remediation prompt with synthetic findings](website/assets/prompt.webp)](docs/remediation-prompts.md) | [![Workbench with synthetic evidence and notes](website/assets/workbench.webp)](docs/workbench.md) |
| Filter findings and inspect available flows. | Preview selected findings before copying a handoff. | Keep pinned evidence, notes and verification results. |

Watch the [showcase video](website/assets/marx-showcase.mp4), read its [text transcript](docs/walkthrough.md#showcase-transcript), or follow the [full walkthrough](docs/walkthrough.md).

## Get started

Install Git, Go 1.27.3 and Bun 1.4.4. macOS builds require Apple Silicon and Xcode Command Line Tools; Windows builds require Windows 11 x64 with WebView2. Windows installer creation also requires NSIS 3.12. Obtain the official Checkmarx CLI separately through your organization; Marx does not download it.

```sh
git clone https://github.com/aaarslan/marx.git
cd marx
bun install --frozen-lockfile
bun run build
bun run start
```

The build selects the host platform. Outputs are `dist/Marx.app` on macOS and `dist/Marx.exe` on Windows. Use `bun run dist:win` on Windows to create the per-user installer. See [building and verification](docs/building.md) for exact platform commands and toolchain setup.

1. Open **Settings**, select the official CLI and optional configuration file, and choose **Save connection and test**. Existing CLI authentication is the default.
2. Choose a source folder, confirm its Checkmarx project, and review the scan options before upload.
3. Open **Results** to investigate findings, prepare a handoff, or track remediation in **Workbench**.

Command+O / Ctrl+O selects a folder. Command+R / Ctrl+R starts the configured scan. Follow [the walkthrough](docs/walkthrough.md) for the complete workflow.

## Platform and security status

Marx uses Wails 3.1.0, Go, SQLite and React with the system webview. No Bun, Node or Electron runtime is distributed.

| Platform | Current status |
| --- | --- |
| macOS Apple Silicon | Native synthetic workflow and locally built app verified; ad hoc signed, without notarization |
| Windows 11 x64 | Prior revision passed native synthetic acceptance, race checks and install/uninstall; latest interaction changes need native Windows follow-up |

Linux, Intel macOS and Windows ARM64 are outside the supported targets. Windows packages are unsigned. Synthetic checks do not establish live tenant acceptance. See [current limitations](docs/limitations.md) and the [final acceptance checklist](docs/final-acceptance.md) for evaluation boundaries.

Optional saved keys use Windows DPAPI or macOS Keychain-backed encryption. Local evidence and exports can contain sensitive information; the SQLite database is not encrypted. Public intelligence lookups are optional and send only CVE IDs where required. Marx has no analytics service. The Wails child-frame bridge boundary remains documented alongside application mitigations in [SECURITY.md](SECURITY.md).

## Development

```sh
bun run typecheck
bun run test --pool=threads --maxWorkers=2
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
