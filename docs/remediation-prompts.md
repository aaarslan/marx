# Remediation prompts

Results → Fix with AI builds a local handoff for a coding assistant. It requires no model account or API key in Marx and performs no automatic repository edits or provider calls.

## Scope

The dialog captures a snapshot of the loaded scan and its metadata when opened. The default is Critical and High findings. An explicit severity filter is carried into the dialog; opening it while inspecting a finding selects that finding and its severity. Users can switch between all loaded findings, current results filters and the current finding when those scopes exist. Empty selections cannot be copied or saved.

The generated context includes the known scan, project, branch and source-folder name, plus the selected scope and loaded/total counts. Missing metadata is omitted. Partial scan data and synthetic demo evidence are identified explicitly. Findings outside the selected scope and severities are not included; findings marked Not Exploitable retain their state and the assistant is instructed to review their rationale rather than blindly change code.

An explicit selected set or fix group can seed the dialog. **Track remediation** saves that exact selection and the reviewed handoff in a named Workbench session with pinned original evidence. Later notes, change references, checks and verification scans stay attached to that session. The [workbench guide](workbench.md) describes evidence retention and verification gates.

## Evidence and batching

Each numbered finding includes its original normalized title and description, scanner/severity/state, local occurrence and vendor identities, source location, CVE/CWE references, dependency paths when present, vendor redundancy hints and the complete available source flow. Ambiguous duplicate identities are labeled. Scanner text is encoded as JSON and explicitly treated as untrusted evidence rather than instructions. Local source snippets are not automatically attached. The linked source-folder path is reduced to its basename; existing paths in scanner evidence are preserved.

Prompts sort by severity and retain stable ordering within a severity. Batches contain at most the selected 10, 20 or 40 findings and target approximately 32,000 characters including instructions. Every batch is independently usable and includes its batch number and scope. If a single finding exceeds that target, its full evidence remains included and the dialog identifies the oversized batch. No finding or evidence field is silently truncated to meet a model limit.

Copy writes the current batch as plain text through Electron's main-process clipboard API. Save writes every batch into one UTF-8 Markdown file at a user-selected destination. Canceled saves do not write. Clipboard and file exports are limited to 8 MiB of UTF-8 text, with an explicit error for larger payloads; new prompt files request mode 0600 on POSIX systems.

## Assistant templates

`src/shared/remediation.ts` exports `REMEDIATION_TARGETS`. Each entry has an id, display name and assistant-specific instruction. Adding an entry extends the target type, dropdown and template lookup without changing result fetching, scan execution or IPC. The generic template supports assistants that do not have editing tools by requesting exact patches and explicit validation gaps.

This is prompt interoperability, not a direct model API integration. No provider credentials, authentication flows, metered fallback or assistant launch is implemented. The user chooses where to paste the reviewed prompt.

The shared prompt contract asks the assistant to verify repository/branch context, preserve unrelated work, consolidate related dependency fixes, inspect SAST flows, avoid suppressions or weakened checks, run appropriate local validation, and report unresolved finding IDs. A fresh Checkmarx scan is required before claiming that a vulnerability is resolved.

## Validation

`tests/remediation.test.ts` covers severity scope, evidence preservation, stable ordering, count/size batching, oversized evidence, partial/demo labeling and templates. `bun run verify:cli` exercises the built Electron app with synthetic CLI results, clipboard and save-dialog stubs, and isolated temporary files. It checks prompt selection, copy payloads, real Markdown file bytes, multi-batch navigation/export, dropdown padding, dialog layouts, Escape and focus return. It does not call an LLM or validate a remediation performed by Copilot.
