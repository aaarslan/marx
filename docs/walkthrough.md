# Using Marx

Marx is an independent desktop GUI for the official Checkmarx One CLI. The CLI runs locally; analysis runs in your Checkmarx tenant. Marx does not provide a Checkmarx account or license. All public screenshots and the showcase film use synthetic findings.

## 1. Build and open

Follow [Building Marx](building.md) for pinned toolchains, platform requirements and exact commands. On Apple Silicon, install Go 1.27.3, Bun 1.4.4 and Xcode Command Line Tools, then run:

```sh
bun install --frozen-lockfile
bun run dist:mac
bun run start
```

The local macOS build is ad hoc signed, not notarized. There are currently no published release downloads. Windows builds require the Windows toolchain and WebView2. Cross-compilation on a Mac does not establish Windows runtime acceptance.

## 2. Connect the official CLI

Obtain your organization's approved Checkmarx CLI separately. Open **Settings**, select its executable and configuration, and choose existing CLI authentication or explicitly save an API key. Check your tenant and credentials before scanning. **Save connection and test** saves the connection fields, then checks CLI authentication and project access without starting a scan. Existing CLI authentication avoids storing another key in Marx. Saved application keys use macOS Keychain-backed encryption or Windows DPAPI. Denied OS access fails closed; replace or remove and re-save the key through Settings if executable replacement makes an older credential inaccessible.

Never paste credentials into notes, prompts, screenshots or issue reports. API keys and existing CLI authentication are different modes; changing modes is an explicit action.

The connection check keeps Settings open so you can read its result and correct the selected fields. **Help → Marx documentation** opens this walkthrough in your external browser while leaving the application available.

## 3. Run a scan

Open **Scan**, use the native folder picker (Command+O on macOS, Control+O on Windows), or drop a folder. Map it to the intended Checkmarx project. Check the branch, scanners and effective settings, then start the scan. Review the source before upload: the selected CLI uploads it to your tenant.

Progress and logs stay in the application. Cancel stops the local process tree; cancellation cannot promise a remote scan has stopped. If submission status is uncertain, inspect tenant/history state before starting another scan. Do not assume a timeout means nothing was submitted. Command+R / Control+R starts the configured scan. Review the Scan view before using it.

For **Batch Scan**, inspect the discovered roots and mappings before starting. Shared workspace files can affect multiple packages. Review dependency changes at the workspace root rather than treating every package as independent.

Prepared packages, selections and overrides remain available when you visit another view during the same application session. Changing the CLI connection clears that connection's prepared batch. Deliberate navigation opens the destination at the top of its content; scan updates do not reset the current view's scroll position.

## 4. Investigate results

In **Results**, choose a scan. Filter by scanner, severity and state; search finding names, files and CVEs. Open a finding for its location, flow and available evidence. Use **Group by fix** to inspect related work. Only a page of matching results is returned to the view. Saved evidence can be read without starting another scan.

If **History** cannot load remote scans and has no saved evidence, use **Open CLI settings** to check the connection, then return and refresh. This unavailable state does not establish that your tenant has no scans.

Choose a baseline to compare available evidence. Enable other branches only when the comparison is intentional. Missing source revision or effective configuration stays visibly unavailable. A disappearing finding alone does not prove a code change fixed it when scan scope or evidence differs.

![Results with synthetic findings](../website/assets/results.webp)

## 5. Prepare a change

Select the relevant findings and choose **Fix with AI**. Inspect the generated prompt, then copy it to the assistant of your choice. Prompt generation happens locally. Marx does not call a model or modify the repository for you. Review what you copy: finding details and paths can contain proprietary information. Apply and test the proposed change in your usual development workflow.

![Local remediation prompt](../website/assets/prompt.webp)

## 6. Keep a workbench session

Use **Workbench** to retain a named session, pinned findings and notes. Keep the original evidence while changing the code. Link the relevant repository intentionally. After testing, run a verification scan and compare compatible evidence. Inconclusive verification remains inconclusive; absence of evidence is not a successful fix.

Verification feedback appears beside its controls. If comparison is rejected, the previous comparison remains available with its original checked time; the error explicitly says it was not updated. Choose a completed scan later than the baseline and compare again.

![Workbench with synthetic notes](../website/assets/workbench.webp)

## 7. Export and troubleshoot

**Export evidence** offers CSV, JSON and SARIF. CSV and JSON write the filtered findings to Downloads and reveal the file; SARIF uses the official CLI and a native save dialog. The application reports the destination or a canceled save. Remediation prompts, Workbench bundles and decision archives also use native save dialogs. Canceling preserves the underlying view and returns keyboard focus to the originating control. Exports, logs, screenshots and the local database can contain sensitive source details. Store and share them accordingly. Database file permissions reduce accidental access; the database is not encrypted.

If the CLI is missing, correct its executable path in Settings. For authentication errors, verify the selected mode and tenant with your administrator. For unsupported/corrupt databases, preserve the original profile and test with a fresh isolated profile as described in the build guide. Do not delete your working profile as a first troubleshooting step.

Production builds have no acceptance server. The acceptance build is only for isolated synthetic verification and must never be distributed.

## CVE intelligence and decision review

Open **Settings → Public CVE intelligence** to enable the sources you want, then save those preferences. Sources start disabled and fetch only when you explicitly refresh. FIRST and CVE.org receive the requested CVE IDs; CISA's public catalog is downloaded as a whole. No source code, paths, package inventory, tenant details or Checkmarx credentials are sent.

In **Results**, expand a CVE finding's intelligence panel or refresh the scan's CVEs. Inspect KEV membership, EPSS probability and date, named CVSS scorers and reference tags. Source errors and stale values stay visible. Intelligence filters are separate from scanner severity.

Use **Watch CVE** to track later observed changes in the **CVE intelligence** view. Its **Watching** state confirms the watch and lets you stop watching. Choose **Record decision** to save a scoped rationale, review date and optional evidence assumptions. **Workbench → Decisions** flags broken assumptions and retains both the original observation and the evidence that prompted review. Revise or close the decision explicitly; none of these actions change Checkmarx result states or verify a fix.

Removing a watched item moves keyboard focus to the nearest remaining item, or reveals the CVE lookup field when the list becomes empty.

Tab and Shift+Tab cycle through the prompt and decision dialogs. Escape dismisses the dialog and returns focus to its launcher without closing the finding underneath. Closed decisions retain pinned evidence and revision history; they are no longer rechecked against current intelligence.

Read [CVE intelligence and decision reviews](cve-intelligence.md) for source controls, exact disclosure, export semantics, retention and limits.

## Showcase transcript

- **0–5 seconds:** Less flag wrangling. More fixing. Marx, a desktop workspace for Checkmarx One.
- **5–12:** Choose your source and settings through a graphical scan workflow.
- **12–20:** Filter findings and inspect the available evidence.
- **20–28:** Add known-exploitation and published-probability context, with visible sources and unknowns.
- **28–36:** Preview the scope, then copy a local remediation handoff. Marx confirms the copy.
- **36–43:** See an active decision move to needs review after exploitation evidence changes; original evidence stays pinned.
- **43–48:** Scans through the official CLI. Optional public intelligence uses CVE IDs, without source code or credentials.
- **48–52:** Marx. Explore the source and build guide.

The 52-second film is an edited product showcase, not an uninterrupted recording or live tenant verification. Its screens were captured from the actual native application using an isolated synthetic CLI and acceptance-only intelligence fixture. Music is generated locally from the checked-in score script.
