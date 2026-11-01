# Final acceptance before merge

Validate the exact PR head and record its commit, Windows/WebView2 versions, toolchain versions and pass/fail results. Earlier passing runs qualify their original revisions only. Keep profiles, credentials, raw exports, machine inventories and screenshots containing private data outside Git. This checklist is a verification contract, not evidence that its unchecked items passed.

## Current evidence

### macOS UI follow-up after `558bca9`, November 1, 2026

The Windows shell correction is retained. The macOS production bundle was launched through Launch Services with a fresh disposable profile. Native pointer and keyboard interaction verified Settings scrolling with anchored navigation, disabled initial intelligence sources, unsaved-preference feedback, invalid-CVE validation with input focus, lowercase CVE normalization and watched-state feedback. This is focused production coverage, not completion of the entire manual checklist.

The UI follow-up adds a bounded watchlist beside the investigation, neutral selected rows, loading and error states, source-operation feedback, decision review counts and clearer evidence grouping. Keyboard actions remain immediate. The source and scan boundaries are unchanged. External design skills were consulted outside the repository; no skill installation or new application dependency is included.

Both TypeScript configurations, 46 frontend tests, production macOS packaging, Windows production cross-build and privacy checks pass. The updated native regression covers validation focus, watch toggling without losing keyboard focus, decision return focus and the existing shell-scroll invariant at 960×640. A malformed expression in the new test probe initially timed out; the probe was corrected. The full race-instrumented native workflow passed with the corrected probe. Screenshots and the 52-second film were refreshed from synthetic native states; media decoding and Hyperframes checks pass.

The Windows results below qualify their recorded source revisions. The new UI controls and focus behavior require Windows follow-up on the final head. Native-dialog targeting limitations, broader manual acceptance, live tenant verification and distribution signing remain open.

### Windows scroll repair follow-up, November 1, 2026

The production retry exposed a real shell-scrolling defect: moving to lower Settings controls could scroll the outer document and move sidebar navigation offscreen, leaving a large blank area. The initial input-blocker diagnosis below was incomplete. A native regression reproduced an outer-document scroll of approximately 557 pixels on the original binary. The repair clips outer roots and fixes the application root to the viewport; Settings retains its own scrolling pane. The regression checks outer scroll position and sidebar bounds after focusing lower Settings actions and attempting outer scrolling. It failed against the original binary and passed in complete race-instrumented WebView2 runs at both normal size and 960×640 after the repair. Both full runs retained all intelligence, decision, persistence and containment checks without reported races.

Additional actual production observations: navigation into CVE intelligence and Settings worked; all three source switches were visibly off before deliberate enablement. Saving preferences and selecting the exact public CVE left sources marked not checked until explicit Refresh intelligence. Refreshing the authorized CVE displayed fresh CISA KEV, FIRST EPSS and CVE.org observations, with listing/score dates, distinct probability and percentile labels, named CVSS scorer and published SSVC context. Adding the CVE changed the watchlist count to one. This was real public-provider data in the production executable, not the synthetic intelligence adapter. Restart persistence and watch removal were not established in this manual follow-up.

The final repaired release passed typecheck, 46 frontend tests, both Windows distribution builds, packaging, site verification, Bun audit and binary govulncheck. Its isolated silent install and same-artifact reinstall returned zero, matched the release executable and preserved settings. The final installed executable launched. Uninstall returned zero, removed the executable and registration and retained the disposable SQLite database; final hashes remain outside Git. Earlier native source/race results remain distinct from these CSS-only follow-up checks.

Ctrl+O opened the real native folder picker. Completing that picker remained blocked by the automation surface: window inventories exposed the disabled owner but no separately selectable dialog window; dialog element targeting failed and owner-directed inputs did not establish selection. The remaining production interaction items below therefore remain unqualified, including physical drop, picker completion, scan shortcut completion, prompt/export dialogs, Workbench and decision editing, refresh error/cancel scenarios, cache clearing and full keyboard/screen-reader coverage. The source-only preview recommendation remains to keep the PR open until those checks are completed. The CSS repair needs a macOS visual follow-up; no new guide flow or showcase content was introduced, and no new video render or website publication is claimed.

### Windows validation of `60581171f9bbdc38c4f826488ac12c40af00fc22`, November 1, 2026

The checkout was clean and origin matched the required commit. No additional remote changes were present. Go 1.27.3, Bun 1.4.4, WebView2 156.0.4314.58 and NSIS 3.12 were used on native Windows 11 x64. Toolchain overrides were confined to child PowerShell sessions. No application code changes were required by the completed checks.

Each command's exit status was checked before proceeding. Frozen installation, both TypeScript projects, 46 frontend tests, native Go tests, vet and the immediate-child containment regression passed. The native race suite passed using the existing portable LLVM-MinGW UCRT compiler. The private race-instrumented production/acceptance host passed the complete runtime harness at normal size and at 960×640 without reported races. Both outputs included synthetic intelligence refresh, the native decision dialog and assumptions, changed-evidence review, immutable pins, watch events and decision persistence, plus DPAPI, clipboard IPC, SQLite, 5,051 findings, paging, scan recovery and CLI cleanup after host termination.

Production build, both Windows distribution commands, packaging verification, Bun audit, site verification and govulncheck source/resource-tool and binary analysis passed. Production metadata contained only the production tag and CGO was disabled. Packaging rejected acceptance transport and synthetic intelligence fixture markers. The opt-in integration test passed against the three real public providers for its single known public CVE; the enabling environment variable was removed afterward. This establishes public-provider connectivity, not Checkmarx compatibility or a manual inspection of provider values.

The actual production executable and the isolated installed executable launched and rendered the initial Scan view with accessible navigation names. An isolated silent NSIS install returned zero and its payload matched the release executable. Reinstalling the same final artifact into that destination returned zero and preserved the settings hash; the installed app launched again. This is same-version reinstall coverage, not a previous-version migration test. Silent uninstall returned zero, removed the application and uninstall registration, and retained the disposable SQLite profile. Final artifact hashes were recorded privately outside Git. Interactive installer pages were not qualified.

**Production interaction blocker:** automated navigation clicks, coordinate clicks, Tab, Ctrl+O and Alt+Space produced no observed action. Restarting the production app and the Computer Use session did not resolve this. An independent Alt+Space probe in a disposable File Explorer window also produced no observed response. This supports a native input-delivery blocker; it does not establish that Marx itself ignores physical user input. No OS protection or machine-wide setting was changed to bypass it.

Consequently every production interaction checklist item below remains unqualified on this head: folder drop/picker/mapping and shortcuts; keyboard traversal, Escape and dialog focus; normal/minimum Results layout, paging, filters and output stability; prompt scope/severity/batching/preview/copy/save/canceled save; JSON/CSV/SARIF native dialogs; session notes/references, original/current evidence and restart; fresh-profile source defaults and absence of automatic lookup; explicit provider enablement and value/reference inspection; refresh cancellation, competition, disabling, offline/stale/error recovery; watch add/remove persistence; decision creation/revision/closure/history/export and unchanged scanner state; cache clearing and retained evidence. Deterministic tests and synthetic WebView coverage passed but do not replace those production interactions. Screen-reader operation was not tested. An unavailable-network production scenario was not induced.

Live Checkmarx verification: **BLOCKED: needs API key**. No tenant credentials or customer source were used. Signing and notarization remain unqualified. The PR should remain open pending production interaction validation; passing automated checks alone do not satisfy this acceptance contract. No user-visible implementation changed, so no fresh video render or macOS implementation follow-up is required by this documentation-only record.

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
