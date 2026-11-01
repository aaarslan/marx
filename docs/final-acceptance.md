# Final acceptance before merge

Validate the exact PR head and record its commit, Windows/WebView2 versions, toolchain versions and pass/fail results. Earlier passing runs qualify their original revisions only. Keep profiles, credentials, raw exports, machine inventories and screenshots containing private data outside Git. This checklist is a verification contract, not evidence that its unchecked items passed.

## Current evidence

The CVE integration at `30ab3f6` passed 46 frontend tests, both TypeScript configurations, native Go race tests and vet on macOS, production macOS packaging, dependency audits and staged privacy checks. Native WKWebView synthetic acceptance passed at 960×640. Windows production cross-build and target-specific vet passed on the Mac. An explicitly enabled known-public-CVE smoke test succeeded against all three public intelligence providers. The landing page and 52-second video were published and their served files matched the staged build.

The Windows run at `e1964ad` predates the CVE integration. It does not qualify the new controls. Documentation-only follow-ups do not alter those executable results; use the current head for the final Windows build.

## Native Windows automated checks

- [ ] Install the locked dependencies and run typecheck, frontend tests, native tests and vet using the pinned toolchains in [building](building.md).
- [ ] Run the native race suite and the immediate-child process containment regression.
- [ ] Build an acceptance-tagged host and run `verify:runtime` at the normal size and with `MARX_VERIFY_MINIMUM_SIZE=1`. The harness must report intelligence refresh, the native decision dialog, changed-assumption review, immutable pins, watch events and restart persistence, in addition to the existing scan and containment checks.
- [ ] Build the production executable and installer. Run packaging, source/binary vulnerability analysis, privacy and site checks. Confirm no acceptance transport or synthetic intelligence adapter is shipped.
- [ ] Repeat isolated install, installed-app launch, upgrade and uninstall with profile retention using the final artifact. Inspect its version and record its hash privately with the results.

## Production interaction checks

Use a disposable profile and synthetic findings. Record production GUI checks separately from acceptance-harness checks. Do not upload customer source to establish a local UI result.

- [ ] Select and physically drop folders; confirm mapping, focus and branch behavior. Exercise Ctrl+O, Ctrl+R, keyboard-only navigation and Escape without duplicate submission.
- [ ] At 960×640 and the normal window size, inspect Results toolbar alignment, paging, filters, finding selection and scroll/focus stability during output.
- [ ] Exercise prompt preview, severity/scope changes, batching, copy, save, canceled save and focus restoration. Verify native exports contain the selected evidence and no extra findings.
- [ ] Create a remediation session, edit notes and references, restart, and inspect pinned evidence and current observations separately.
- [ ] In a fresh profile, confirm intelligence sources are disabled. Saving preferences, opening a finding and recording a local decision must not themselves refresh providers.
- [ ] Enable sources explicitly. With one known public CVE, inspect source dates, probability versus percentile, named CVSS scorers, SSVC context where available, and browser reference navigation. Do not execute reference contents.
- [ ] Exercise refresh progress, cancellation and a competing refresh. Turn a source off during refresh; inspect the canceled state. With networking unavailable, confirm cached positive KEV evidence remains qualified and missing EPSS never becomes zero. Restore networking and refresh successfully.
- [ ] Add and remove a watched CVE, restart and inspect persistence. Use the synthetic acceptance run for deterministic changed-provider events; do not claim a real public CVE changed on demand.
- [ ] Record and revise a decision with a rationale, future review date and supported assumptions. Inspect revision history, explicit closure and JSON export. Confirm scanner state is unchanged. Use the deterministic native intelligence tests for later-refresh/cache-clear retention, and the synthetic webview run for the visible changed-assumption workflow.
- [ ] Clear fetched cache and disable sources. Confirm original session and decision evidence remains readable. Check accessible names, keyboard traversal and dialog focus in the new controls; record any screen-reader coverage separately.

## External requirements and merge decision

Live Checkmarx verification remains **BLOCKED: needs API key** until an approved disposable tenant and source fixture are available. Check authentication, project mapping, SAST/SCA submission, monitoring, cancellation, reports, triage and SARIF with that environment before claiming tenant compatibility. Public intelligence smoke checks do not satisfy this requirement.

Windows signing and macOS Developer ID signing/notarization remain unqualified. They are distribution requirements, not prerequisites for a source-only preview merge, provided the preview and limitations remain explicit. Published installer releases need a separate release qualification decision.

Resolve any failing automated or production interaction check before merging. If live tenant verification remains unavailable, a preview merge must retain that limitation explicitly; it must not be described as production-qualified. Keep the PR open until the final validation report identifies the tested head and any accepted remaining boundaries.
