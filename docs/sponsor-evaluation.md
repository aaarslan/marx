# Sponsorship and technical evaluation

Marx is an independent, MIT-licensed desktop workbench for investigating Checkmarx One findings and preserving evidence through remediation. It is not affiliated with, endorsed by, or sponsored by Checkmarx. This is a proposed evaluation and support plan, not an accepted partnership or evidence of customer adoption.

## Why support Marx

The case to test is practical: can a focused desktop workspace help existing Checkmarx users investigate findings and prepare a useful developer handoff faster, while retaining the evidence behind their decisions?

Marx combines local project navigation, finding investigation, pinned evidence, notes and reviewed assistant handoffs. It uses the organization's approved official CLI for remote scans. Prompt preparation stays local; the user decides what to share with a coding assistant. These are implemented capabilities, described in the [walkthrough](walkthrough.md), rather than measured productivity benefits.

Checkmarx already offers [Triage & Remediation Assist](https://checkmarx.com/product/triage-and-remediation/) and a [hosted MCP integration](https://checkmarx.com/solutions/checkmarx-mcp/) for accessing scanning and remediation workflows from AI tools. Marx's proposed contribution is a complementary desktop investigation and evidence workflow. Evaluation should establish where that workflow helps customers alongside their existing Checkmarx tools. It should not assume those tools lack equivalent features or claim that Marx replaces their governance.

## A documented route

As reviewed on November 3, 2026, Checkmarx's [Technology Alliance program](https://checkmarx.com/company/checkmarx-appsec-partner-program/) invites ISVs and platform vendors building integrated solutions. Its public description includes technical resources, engineering collaboration, marketplace visibility and joint marketing. The **Become a Tech Partner** route on that page is a relevant starting point for a conversation. Eligibility for an independent, CLI-based open-source project needs confirmation; the page does not promise funding.

Checkmarx also [maintains and supports open-source tools](https://checkmarx.com/open-source-and-free-tools/). That establishes an interest in open source, not a commitment to sponsor Marx. No general cash-sponsorship application program was identified in the official sources reviewed.

## Evidence available and missing

The repository contains synthetic workflow coverage and dated Windows and macOS acceptance records. Public screenshots and the edited showcase film use synthetic findings. They demonstrate the interface, not a live customer deployment or measured time savings.

Live tenant compatibility remains unverified. Published installers are unavailable; Windows builds are unsigned and macOS builds are ad hoc signed without notarization. Framework, local-storage and evidence limitations remain in [SECURITY.md](../SECURITY.md) and [current limitations](limitations.md). A clean dependency scan would not resolve all of those boundaries.

Native evidence qualifies only its recorded revision. The November 2 Windows confirmation covers `22de33de7207bc6961e67d033a15097d9aa2826d`; later review changes need their own native validation. See [final acceptance](final-acceptance.md) for the exact scope and distinction between reported confirmation, synthetic checks and production interaction.

## A small evaluation with a decision

Propose a two-week evaluation with three to five developers or AppSec practitioners from one or two consenting teams. Agree on a specific Marx revision, approved CLI version, test tenant and disposable or approved repository before starting. Begin with a live scan, result import and export on both supported operating systems; record compatibility failures before measuring workflow value.

Use ten representative, predefined finding-review tasks. Compare the team's current workflow with Marx, varying task order and allowing a short practice session. Keep equivalent evidence available in both workflows. Record these outcomes without collecting private source or findings in public reports:

| Measure | Record | Proposed success condition |
| --- | --- | --- |
| Investigation and handoff time | Task completion time, median and range for each workflow | At least 20% lower median time with Marx, without reducing handoff quality |
| Evidence quality | Reviewer checks of finding identity, source references, notes and verification status | No lost required evidence or incorrect claim that a finding is fixed |
| Workflow reliability | Failed operations, recovery steps and tasks needing maintainer help | Every task completes or has an explicit, reproducible blocker; no serious unresolved data-handling defect |
| Continued usefulness | Participants who choose Marx for a further task, with their reasons | A majority want to continue using it and can identify a specific benefit |

These are proposed targets, not results or published Checkmarx requirements. Agree on them before testing. The small sample can guide a product decision; it cannot establish a general productivity claim. Publish only sanitized outcomes with permission, including failures and the versions tested. If the workflow brings no clear benefit over existing tools, narrow the scope before seeking recurring funding.

## A phased support request

**First, validate the integration.** Request an approved non-production evaluation environment, a named technical counterpart, CLI compatibility guidance and introductions to willing evaluators. The deliverable is a short compatibility and workflow report with reproducible failures and a clear continue, narrow or stop decision.

**Then, fund specific release work.** If the evaluation demonstrates useful differentiation, propose a bounded maintenance period covering the accepted defects, independent security review, current Windows/macOS acceptance, and signing and packaging. Agree on a budget, deliverables, support ownership and review date; do not promise an ongoing service level before those resources exist.

**Finally, discuss public recognition.** An integration listing, joint demonstration or ongoing maintainer support should follow an agreed scope and accepted evidence. Keep Marx's independent identity. Use Checkmarx partner or sponsor branding only after written approval. Support does not itself certify the application's security.
