# Security and release review — November 3, 2026

## Assessment

Marx has a credible developer-preview foundation and a coherent visual design. This review found and repaired application defects that dependency scanners do not detect. The checked JavaScript dependency tree and Go targets returned no known vulnerability findings. That does **not** establish that Marx is free of vulnerabilities or ready for unrestricted enterprise distribution.

The reviewed baseline was `b0f283db88dfbd7663425edc93519fa8a4740b2d`. The fixes and regression tests are in the commit containing this report. Dependency pins and lockfiles were retained. No GitHub Actions, remote scan jobs, or paid services were added or invoked.

## Findings repaired

| Finding | Impact and repair |
| --- | --- |
| Incomplete authorization-header redaction | An opaque Bearer or Basic credential emitted by the selected CLI could survive redaction and enter captured logs. Redaction now removes the complete authorization value on the line, including proxy and structured header forms. Tests reproduce the failure against the original code. |
| Blocking reads of special files | Configuration, source-snippet and fingerprint reads could block opening a FIFO before checking whether it was a regular file. Reads now check file type before opening, retain checks on the opened file, and use nonblocking opens on macOS to cover replacement races. FIFO regressions reproduce the old blocking behavior. |
| Workspace state crossing connection changes | Older initialization, bootstrap and navigation responses could overwrite a newer connection's state. Old job events and diagnostics were also accepted. The renderer now ignores superseded reads and foreign events, resets single-scan configuration on connection changes, and preserves newer job events received during a read. |
| Delayed workspace saves using the wrong connection | Navigation and Results saves now carry their connection identity. The engine rejects a mismatched identity before saving. A rejected old save cannot replace the current workspace's error state, and mismatched saved navigation is ignored. Legacy saved navigation without an identity remains readable. |
| Pruned jobs remaining visible | Refresh previously restored removed jobs from renderer memory. It now removes obsolete jobs and logs while retaining updates received during the fetch. |
| Settings failures appearing as endless loading | Workspace failures now show an actionable error and retry control. Settings displays an explicit unavailable state until recovery succeeds. |
| Privacy verifier reporting false success | The all-files check could miss a credential still in the Git index when the working copy was clean or absent. It now checks indexed content and available working content, recognizes additional GitHub token formats, and derives the installer filename from the current version. Home-path detection distinguishes complete path components from similar source filenames. Finding diagnostics omit stack traces that could disclose local paths. Regression fixtures are synthetic and matched values remain withheld. |
| Stale or overstated verification information | Native Help now opens documentation on `main`. Packaging output identifies its NSIS source-declaration check and does not imply that a built installer was inspected. Project status distinguishes the recorded November 2 Windows confirmation from these later changes. |

These are review findings, not assigned CVEs. The redaction algorithm failure was reproduced with synthetic output; a live Checkmarx credential leak was not induced. No evidence of credential compromise was established. The fix protects future captured output; it does not scrub previously saved logs or exported bundles. The workspace identity check prevents accidental stale writes; it is not an authentication boundary.

## Verification and scope

The review environment was Linux x64 with the repository's pinned Bun 1.4.4 and Go 1.27.3. It cannot run WKWebView, WebView2, Windows installation, macOS Keychain or Windows DPAPI acceptance.

| Check | Result and boundary |
| --- | --- |
| Frozen Bun installation | Passed with the checked-in lockfile. |
| `bun audit --json` | Returned `{}` with exit code 0. Covers the frontend and development dependency tree; it does not scan application logic or the separately installed Checkmarx CLI. |
| Windows-targeted `govulncheck` | No findings for `./native/... ./tools/resources`, using symbol-level source analysis. Scanner v1.9.0; vulnerability database last modified `2026-11-02T22:01:43Z`. |
| macOS-targeted engine `govulncheck` | No findings for `./native/engine ./tools/resources` targeting Darwin arm64. This excludes the native Cocoa host, which cannot be analyzed as a complete native build here. |
| Go module integrity | `go mod verify` passed. |
| Secret scanning | Gitleaks 8.30.1 reported no findings across all 43 reachable commits and a separate current-source snapshot including the new files. Reports were redacted. This is pattern-based detection, not proof that every possible secret is absent. |
| TypeScript and frontend regressions | Both TypeScript configurations and all 75 frontend/shared/tooling tests passed. New tests reproduce workspace ordering, connection scope and privacy-verifier defects. The production Vite bundle built successfully. |
| Shared Go engine regressions | Passed with the race detector in a temporary Linux test harness. The harness maps the Darwin process/file helpers into Linux-only scratch files; it is not supported-platform runtime acceptance and adds no Linux implementation to the repository. |
| Native test compilation | Engine test executables cross-compiled for Windows amd64 and Darwin arm64. They were not executed on those platforms. |
| Windows build and static analysis | Production Windows x64 cross-build and Windows-targeted Go vet passed. Cross-compilation does not establish native behavior. |
| Windows artifact analysis | Binary-mode `govulncheck` returned no findings. Packaging inspection confirmed the x64 executable, embedded current frontend chunks, Go SQLite engine and absence of acceptance/runtime sidecars. The NSIS source declaration was checked; a built installer was not inspected. |
| Website | Local resource/anchor verification passed. The published landing page was inspected at desktop and 390-pixel phone widths; tab keyboard navigation and the build-guide link worked. Current native screenshots were inspected. |
| New renderer behavior | Store-level regression coverage passed. The changed error/retry presentation and connection-switch interactions still require native WKWebView/WebView2 exercise. The browser could not reach the isolated local preview. |

The repository privacy verifier passed its staged/indexed, available working-file and cross-built executable checks without printing matched values. At the reviewed baseline, the optional history-identity check flags two non-noreply author/committer entries at `df0fc1864ab1` and `b0f2763344ee`. Publication through the GitHub integration also inherits the account's configured non-noreply identity; the integration does not expose an author/committer override. These are identity-policy findings, distinct from the clean secret scan. Their values are omitted here and shared history was not rewritten. Repeat relevant checks on the exact source and artifacts intended for release; a report is a dated snapshot.

## Security boundaries still open

### Wails child frames

The upstream [Wails 3.0.0 release](https://github.com/wailsapp/wails/releases/tag/v3.0.0) describes **GHSA-2p5f-2gx8-mh8m** as partly fixed: child frames can still reach bound Go methods through the runtime HTTP endpoint. The [3.1.0 release](https://github.com/wailsapp/wails/releases/tag/v3.1.0) does not claim complete resolution. Marx pins 3.1.0 and does not embed external pages or frames.

Marx's CSP, frame-request rejection, origin checks and external-browser routing reduce exposure. Source inspection confirmed that Wails application asset middleware wraps the runtime transport too. These are application mitigations, not an upstream patch or proof against every embedding/XSS path. The Go scanner returned no finding for this documented limitation. Keep the separate assessment in [SECURITY.md](../SECURITY.md); do not add embedded content without reassessing it.

### Local evidence and separately installed software

The evidence database and exports are not encrypted by Marx. OS-protected key storage does not encrypt findings, notes or logs. The OS account and its filesystem remain trusted. The official Checkmarx CLI, WebView2/WKWebView, operating system and their update policies are outside the checked lockfiles. Live Checkmarx tenant acceptance was not performed.

### Distribution and release acceptance

Windows packages remain unsigned; macOS packages remain ad hoc signed without notarization. No new installer or signed release was published. Before a release, exercise these fixes on both supported platforms, including connection changes during an active scan, returning to that connection, pruning evidence, error recovery and protected credential storage. Full screen-reader qualification remains outstanding.

## Sponsorship judgment

The public design is polished enough for a technical introduction. The strongest next evidence is a real, approved Checkmarx workflow and a small user evaluation, followed by qualified distribution. The [sponsorship evaluation proposal](sponsor-evaluation.md) describes a concrete Technology Alliance conversation and proposed success measures. It does not claim Checkmarx sponsorship, eligibility, certification or measured productivity gains.
