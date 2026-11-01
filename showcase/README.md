# Marx product film

44 seconds, 1920×1080, 30 fps. HTML scenes are rendered locally with Hyperframes 0.8.226. The final file is `docs/assets/marx-showcase.mp4`. See `SPEC.md` for the editorial contract. App screens contain synthetic findings, not customer data. The score is original procedural synthesis from `soundtrack.py`.

Requirements: macOS for native capture, the application build toolchain, Python 3, ffmpeg and Chrome. No provider account or paid render service is used.

```sh
bun run build
bun scripts/capture-showcase.ts
```

The capture script builds a private acceptance host and fixture, uses a fresh isolated profile, captures five actual native DOM states, and terminates its host. Never ship the acceptance binary. The script snapshots each frozen state in `.cache/showcase/captured/` with the pinned animation runtime. Convert the resulting PNG frames to `docs/assets/{scan,results,detail,prompt,workbench}.webp`. The frozen marketing copies omit the app CSP so the local renderer can initialize; the application CSP is unchanged.

```sh
bun scripts/build-showcase.ts
HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 npx --yes hyperframes@0.8.226 check .cache/showcase/render --json
HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 bun scripts/build-showcase.ts --render
```

Set `HYPERFRAMES_EXECUTABLE` to an existing pinned binary and `HYPERFRAMES_BROWSER_PATH` to Chrome if detection fails. The preparation script downloads checksum-verified GSAP 3.15.0 into ignored staging and retains its license header. Hyperframes is Apache-2.0; GSAP is distributed under its [standard license](https://gsap.com/standard-license/). No vendor code is added to the application. Hyperframes may cache render fonts locally. The site itself uses system fonts and makes no third-party requests.

Inspect all scene snapshots and decoded final frames before replacing the published media. Keep temporary profiles and tooling outside version control. The site transcript and WebVTT track must match any revised edit.
