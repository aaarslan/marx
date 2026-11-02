# Support

Marx is an independent open-source developer preview. Support happens through this repository; there is no guaranteed response time, service-level agreement or enterprise support offering. Checkmarx account, licensing and service questions belong with your organization's administrator or Checkmarx support.

## Find an answer

- [Walkthrough](docs/walkthrough.md): connect the CLI, scan, investigate, prepare a handoff and export evidence.
- [Build guide](docs/building.md): pinned toolchains, native builds and disposable test profiles.
- [Current limitations](docs/limitations.md): supported targets, integration boundaries and verification gaps.
- [Security policy](SECURITY.md): storage, data handling and private vulnerability reporting.

For connection errors, confirm the selected official CLI, authentication mode and tenant with your administrator. A connection check does not establish that a scan will succeed. For an uncertain submission, check Checkmarx One before retrying: the remote scan may already exist. Preserve your original profile when investigating storage errors; use a separate disposable profile for reproduction.

## Ask a question or report a bug

Search [existing issues](https://github.com/aaarslan/marx/issues) first. If no issue matches, [open an issue](https://github.com/aaarslan/marx/issues/new/choose) with:

- The task, expected behavior and observed behavior.
- Marx version or commit, operating system and architecture, and whether it is a local build.
- Minimal reproduction steps, preferably using synthetic data.
- Relevant CLI version and scanner options, when the problem involves scanning.
- A short sanitized error or screenshot, plus any checks already attempted.

Review every attachment before posting. Remove credentials, tenant and customer identifiers, presigned URLs, proprietary source, personal paths and private project details. Avoid attaching raw logs, databases, source archives or evidence bundles. Redaction can miss sensitive information; a small synthetic reproduction is preferable.

**For a suspected vulnerability, use [private security reporting](SECURITY.md).** If the reporting form is unavailable, request a private contact channel in an issue without including vulnerability details. Do not use a public bug report for exploit steps or secrets.

## Suggest an improvement

Use the [feature request template](https://github.com/aaarslan/marx/issues/new?template=feature_request.md). Describe the workflow, who encounters the problem, the desired outcome and any alternatives you tried. Discuss substantial changes before implementing them. [Contributing](CONTRIBUTING.md) explains local checks and review expectations; [project status](docs/project-status.md) identifies useful evaluation and collaboration work.
