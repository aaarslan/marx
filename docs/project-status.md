# Project status and collaboration

Marx is an MIT-licensed desktop workbench for developers and application security teams using Checkmarx One. It brings scan configuration, finding investigation, local remediation handoffs and evidence review into a native application. The official CLI remains the scan boundary; analysis requires an organization's Checkmarx access.

Marx is an independent project. It is not affiliated with or endorsed by Checkmarx. References to Checkmarx identify the service and CLI it integrates with. This page describes collaboration opportunities, not a sponsorship agreement or a commitment to a release date.

## What exists today

Version 0.9.0 is a developer preview built from source. The implementation includes durable scan jobs, finding filters and flows, baseline comparisons, optional public CVE intelligence, local prompts, pinned workbench evidence and exports. See the [walkthrough](walkthrough.md) for the user workflow and [CLI contracts](api-contracts.md) for integration details.

The desktop host uses Go and Wails, React in the system webview, and SQLite for local evidence. Public screenshots and the showcase film use synthetic findings. Local acceptance records describe specific revisions and environments; they do not establish live tenant compatibility or production readiness for every organization.

## Evaluation work still needed

| Area | Current boundary | Useful contribution |
| --- | --- | --- |
| Checkmarx integration | Acceptance uses a synthetic CLI; live tenant acceptance is not established. | Organization-approved evaluation with the official CLI, followed by sanitized compatibility reports and synthetic regressions. |
| Native platforms | macOS Apple Silicon has local acceptance. Windows 11 x64 has recorded native checks, with follow-up needed for the latest interaction changes. | Repeat the current native manual checklist and report the tested revision and environment. |
| Distribution | No published installers; macOS builds are ad hoc signed and Windows builds are unsigned. | Review packaging and signing requirements before a public release. |
| Accessibility | Keyboard and dialog behavior have coverage; full screen-reader behavior remains unqualified. | Native assistive-technology testing with reproducible findings. |
| Security and evidence | Storage and framework boundaries remain documented; evidence compatibility limits can make verification inconclusive. | Review those boundaries, test failure paths, and improve explanations without weakening evidence requirements. |

The [limitations](limitations.md), [security policy](../SECURITY.md) and [final acceptance checklist](final-acceptance.md) are the detailed references. Evaluation with real source or findings must follow the organization's authorization and data-handling rules. Keep private data out of public reports.

## Ways to collaborate

Contributions can include implementation, documentation, native verification, accessibility review, synthetic fixtures and independent security review. An organization considering support can help with approved evaluation environments, maintainer time, or release engineering such as signing and packaging. Scope and access need agreement before work begins; support does not imply product certification, endorsement or a guaranteed delivery schedule.

Start with a [public issue](https://github.com/aaarslan/marx/issues/new/choose) describing the proposed outcome and constraints, without confidential details. If a conversation requires private information, request a private contact route first. Do not post credentials or tenant access. Follow [Contributing](../CONTRIBUTING.md) for changes and [Support](../SUPPORT.md) for usage questions. Vulnerabilities use [private security reporting](../SECURITY.md).
