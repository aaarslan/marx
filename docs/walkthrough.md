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

Obtain your organization's approved Checkmarx CLI separately. Open **Settings**, select its executable and configuration, and choose existing CLI authentication or explicitly save an API key. Check your tenant and credentials before scanning. Existing CLI authentication avoids storing another key in Marx. Saved application keys use macOS Keychain-backed encryption or Windows DPAPI. Denied OS access fails closed; replace or remove and re-save the key through Settings if executable replacement makes an older credential inaccessible.

Never paste credentials into notes, prompts, screenshots or issue reports. API keys and existing CLI authentication are different modes; changing modes is an explicit action.

## 3. Run a scan

Open **Scan**, use the native folder picker (Command+O on macOS, Control+O on Windows), or drop a folder. Map it to the intended Checkmarx project. Check the branch, scanners and effective settings, then start the scan. Review the source before upload: the selected CLI uploads it to your tenant.

Progress and logs stay in the application. Cancel stops the local process tree; cancellation cannot promise a remote scan has stopped. If submission status is uncertain, inspect tenant/history state before starting another scan. Do not assume a timeout means nothing was submitted. Command+R / Control+R starts the configured scan. Review the Scan view before using it.

For **Batch Scan**, inspect the discovered roots and mappings before starting. Shared workspace files can affect multiple packages. Review dependency changes at the workspace root rather than treating every package as independent.

## 4. Investigate results

In **Results**, choose a scan. Filter by scanner, severity and state; search finding names, files and CVEs. Open a finding for its location, flow and available evidence. Use **Group by fix** to inspect related work. Only a page of matching results is returned to the view. Saved evidence can be read without starting another scan.

Choose a baseline to compare available evidence. Enable other branches only when the comparison is intentional. Missing source revision or effective configuration stays visibly unavailable. A disappearing finding alone does not prove a code change fixed it when scan scope or evidence differs.

![Results with synthetic findings](../website/assets/results.webp)

## 5. Prepare a change

Select the relevant findings and choose **Fix with AI**. Inspect the generated prompt, then copy it to the assistant of your choice. Prompt generation happens locally. Marx does not call a model or modify the repository for you. Review what you copy: finding details and paths can contain proprietary information. Apply and test the proposed change in your usual development workflow.

![Local remediation prompt](../website/assets/prompt.webp)

## 6. Keep a workbench session

Use **Workbench** to retain a named session, pinned findings and notes. Keep the original evidence while changing the code. Link the relevant repository intentionally. After testing, run a verification scan and compare compatible evidence. Inconclusive verification remains inconclusive; absence of evidence is not a successful fix.

![Workbench with synthetic notes](../website/assets/workbench.webp)

## 7. Export and troubleshoot

**Export evidence** writes a file you choose through the native save dialog. Exports, logs, screenshots and the local database can contain sensitive source details. Store and share them accordingly. Database file permissions reduce accidental access; the database is not encrypted.

If the CLI is missing, correct its executable path in Settings. For authentication errors, verify the selected mode and tenant with your administrator. For unsupported/corrupt databases, preserve the original profile and test with a fresh isolated profile as described in the build guide. Do not delete your working profile as a first troubleshooting step.

Production builds have no acceptance server. The acceptance build is only for isolated synthetic verification and must never be distributed.

## Showcase transcript

- **0–5 seconds:** Less flag wrangling. More fixing. Marx, a desktop workspace for Checkmarx One.
- **5–12:** Choose your source and settings through a graphical scan workflow.
- **12–20:** Filter findings and inspect the available evidence.
- **20–28:** Generate a local remediation handoff for your chosen assistant.
- **28–35:** Keep pinned findings and notes; compare a verification scan.
- **35–40:** Official CLI uploads, remote analysis, explicit evidence boundaries.
- **40–44:** Marx. Explore the source and build guide.

The 44-second film is an edited product showcase, not an uninterrupted recording or live tenant verification. Its screens were captured from the actual native application using the isolated synthetic CLI fixture. Music is generated locally from the checked-in score script.
