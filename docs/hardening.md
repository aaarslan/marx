# Hardening and optimization pass

This pass reviews the desktop bridge, source grants, CLI output handling, settings persistence and results queries. It is a bounded review and regression pass, not a penetration test or a guarantee that every defect is absent.

## Changes

- The renderer can no longer directly authorize arbitrary source folders or persist new recent-folder grants. Native folder selection/drop establishes the grant, and project mapping and containment checks still apply.
- Desktop admission limits raw input to eight arguments and 64 MiB combined per request, plus a shared 128 MiB pending raw-input budget and the existing 256-operation limit. This limits admitted payloads; it does not cap total application memory or transport allocation before admission.
- Native drop processing admits one pending folder operation and waits at most 20 seconds for startup.
- Oversized settings are rejected before replacing the existing readable configuration.
- Streaming log lines over 16 KiB are omitted as a whole. This prevents redaction across the old truncation boundary from exposing a credential fragment. Raw response bytes remain available to bounded JSON parsing. Overlapping known secrets are redacted longest first. Redaction cannot remove every possible source secret.
- SQLite database and existing WAL/SHM files use owner read/write permissions on macOS. Nonregular database/sidecar paths are rejected. The database remains unencrypted and the account running Marx remains trusted.
- Results queries build search text only when a search exists, prepare filters once and retain only the requested page of matches. Import and JSON decoding still retain the full normalized report within its existing limit.

## Measured effect

The existing 5,051-finding synthetic workload, ten benchmark iterations, changed from approximately 31.17 MB to 28.43 MB allocated per query and from 232,772 to 202,454 allocations. That is about 9% fewer allocated bytes and 13% fewer allocations. Timing was similar; no broad latency claim is made. Run `go test ./native/engine -run '^$' -bench BenchmarkFindingsQuery -benchmem -benchtime=10x` to inspect the workload on another machine.

## Verification

- 42 frontend tests and both TypeScript configurations pass.
- macOS Go race suite and Go vet pass.
- Fresh native WKWebView synthetic acceptance passes, including 5,051 findings, persistence, recovery and CLI descendant cleanup.
- The production macOS bundle and ad hoc signature pass packaging inspection; no acceptance endpoint is shipped.
- Windows production cross-build and Windows-targeted vet pass. New changes have not been exercised in native Windows during this pass.
- Bun dependency audit and Go vulnerability analysis report no vulnerabilities in their checked scopes. The separately documented Wails child-frame bridge boundary remains in [SECURITY.md](../SECURITY.md); dependency scanner success does not erase it.

Live tenant verification is **BLOCKED: needs API key**. No real source upload or metered provider call was performed. macOS notarization, distribution qualification and full screen-reader acceptance remain outside this pass. See [current limitations](limitations.md).

The public walkthrough/site/video use synthetic fixtures and portable summaries. Temporary profiles, raw validation logs, local tool paths and hardware inventories remain ignored or outside the repository.

## Wails 3.1.0 follow-up

The Go host and frontend runtime now pin Wails 3.1.0 together. Desktop asset/runtime middleware additionally rejects cross-site fetch metadata and external or opaque Origin headers; normal native transports without Origin remain supported. A table-driven regression covers same-origin, native-scheme, cross-site, opaque and malformed-origin cases. The fresh macOS native workflow, race suite, vet, packaging inspection, 42 frontend tests and both dependency audits pass. The Windows production cross-build and target-specific vet also pass; native Windows acceptance of this revision remains pending.

The walkthrough shortcut now correctly describes Command+R / Ctrl+R as starting the configured scan. The website has a separate public source directory and an explicit publisher that uses only approved public files, pins documentation to the source commit, rejects dirty checkouts and uses a GitHub noreply identity. Historical Electron material is archived outside the current contributor path. Private vulnerability reporting is enabled for the repository.

## Optional CVE intelligence

The CVE intelligence pass adds opt-in public sources, bounded and cancellable HTTPS requests, strict response validation and a local decision ledger. Cache updates and assumption-triggered review evidence commit atomically. Review flags retain their triggering evidence until an explicit revision or closure. Cache clearing cannot erase pinned session or decision evidence. No source code, tenant credentials or package inventory is sent to intelligence providers.

The implementation passes 46 frontend tests, the native race suite, Go vet and macOS bundle inspection. Native WKWebView synthetic acceptance covers intelligence refresh, cancellation, decision creation, changed assumptions, immutable evidence and restart persistence at the minimum window size. A separately enabled smoke test fetched one known public CVE from all three real providers. This does not establish Checkmarx tenant compatibility. The new feature has only been cross-built and vetted for Windows on this Mac; the Windows acceptance reported for the preceding revision remains distinct.

See [CVE intelligence](cve-intelligence.md) for source disclosure, limits, retained evidence and the explicit public-source verification command.
