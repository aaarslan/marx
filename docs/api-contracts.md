# Checkmarx One API contracts

Marx talks directly to Checkmarx One. These implementation notes replace the development research dump and preserve the contracts covered by the tests.

Request shapes were checked against the official [Checkmarx AST CLI](https://github.com/Checkmarx/ast-cli) source on October 29, 2026. That research used upstream `main` and did not record an immutable commit. Recheck the official source before changing a contract; do not treat these notes as a substitute for real tenant validation.

## Authentication

The API key is exchanged as a refresh token at the token endpoint derived from its JWT `aud` claim. The form-encoded request uses:

| Field | Value |
| --- | --- |
| `grant_type` | `refresh_token` |
| `client_id` | JWT `azp` claim, with the supported default when absent |
| `refresh_token` | The supplied API key |

The access token supplies `ast-base-url` for API discovery. Settings allow explicit connection overrides. Token refresh is shared between concurrent operations; a 401 is retried only once.

Implementation: `src/main/cxone/jwt.ts` and `src/main/cxone/client.ts`. Tests: `tests/jwt.test.ts` and `tests/client.test.ts`.

## Projects and upload

- `GET api/projects?limit=…&offset=…&sort=name` returns project pages and a total count when available.
- `POST api/projects` uses `{name, mainBranch?, tags?}`. The scanner only creates a project after a complete lookup establishes absence. A positive name match can be reused even from a capped list.
- `POST api/uploads` returns a presigned URL.
- `PUT` to that URL sends raw ZIP bytes and a content length. The Checkmarx authorization header is not sent to the upload endpoint.

Local completeness metadata is not part of the server response contract. Missing totals, partial pages and malformed listings must not silently establish that a project does not exist.

Implementation: `src/main/cxone/client.ts` and `src/main/scanRunner.ts`. Tests: `tests/projects.test.ts` and `tests/review.test.ts`.

## Scan creation

`POST api/scans` uses this structure for local-folder scans:

```json
{
  "type": "upload",
  "handler": {
    "branch": "main",
    "uploadUrl": "<presigned upload URL>"
  },
  "project": { "id": "<project ID>" },
  "config": [
    {
      "type": "sast",
      "value": {
        "presetName": "Checkmarx Default",
        "incremental": "false"
      }
    },
    { "type": "sca", "value": {} }
  ]
}
```

Scanner entries are included only when selected. The SAST incremental value is a string. Incremental scans can include `baseBranch`. SCA Exploitable Path uses the case-sensitive key `ExploitablePath` with value `"true"`. Nonempty scan tags are sent at the top level.

Implementation: `buildScanRequest` in `src/main/scanRunner.ts`. Tests: `tests/scanRunner.test.ts`.

## Polling, results and cancellation

- `GET api/scans/{id}` supplies status and queue information. Known terminal statuses include Completed, Partial, Failed and Canceled.
- `PATCH api/scans/{id}` uses `{ "status": "Canceled" }`.
- `GET api/results?scan-id=…&limit=…&offset=…` supplies paged findings.
- `GET api/scan-summary?scan-id=…` is best-effort. Unknown summary shapes remain unavailable rather than displaying reassuring zero counts.

SAST attack flows are read from `data.nodes`. SCA normalization handles dependency/package metadata and location entries. Actual tenant summary and SCA location payloads still need comparison with the Checkmarx One web UI.

Implementation: `src/main/cxone/normalize.ts`, `src/main/cxone/client.ts` and `src/main/scanRunner.ts`.

## Triage

- SAST predicates go to `POST api/sast-results-predicates` as an array.
- SCA updates go to `POST api/sca/management-of-risk/package-vulnerabilities` as a single object.
- Result identity, project, state, severity and comment fields must preserve the endpoint-specific model. The UI requires a comment before submitting a change.

Implementation: the triage methods in `src/main/cxone/client.ts`, with IPC mapping in `src/main/ipc.ts`.

No credentials or real tenant payloads are included in these notes or the test fixtures.
