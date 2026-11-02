import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { writeAnimationRuntime, encodeWebP } from "./showcase-assets";
const root = path.resolve(".cache/showcase/render");
fs.mkdirSync(path.join(root, "assets"), { recursive: true });
fs.cpSync("showcase/compositions", path.join(root, "compositions"), {
  recursive: true,
});
fs.copyFileSync("showcase/index.html", path.join(root, "index.html"));
fs.copyFileSync("showcase/film.css", path.join(root, "assets/film.css"));
fs.copyFileSync("website/icon.png", path.join(root, "assets/icon.png"));
for (const name of [
  "scan",
  "results",
  "detail",
  "prompt",
  "prompt-copied",
  "workbench",
  "intelligence",
  "decisions",
  "decision-baseline",
])
  fs.copyFileSync(
    `website/assets/${name}.webp`,
    path.join(root, `assets/${name}.webp`),
  );
await writeAnimationRuntime(path.join(root, "assets/gsap.min.js"));
execFileSync("python3", [
  "showcase/soundtrack.py",
  path.join(root, "assets/score.wav"),
]);
execFileSync("ffmpeg", [
  "-y",
  "-v",
  "error",
  "-i",
  path.join(root, "assets/score.wav"),
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  path.join(root, "assets/soundtrack.m4a"),
]);
if (process.argv.includes("--render")) {
  const binary = process.env.HYPERFRAMES_EXECUTABLE;
  const video = path.resolve("website/assets/marx-showcase.mp4");
  const args = [
    "render",
    root,
    "--output",
    video,
    "--fps",
    "30",
    "--quality",
    "delivery",
    "--workers",
    "2",
  ];
  execFileSync(
    binary || "npx",
    binary ? args : ["--yes", "hyperframes@0.8.226", ...args],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        HYPERFRAMES_NO_TELEMETRY: "1",
        HYPERFRAMES_NO_UPDATE_CHECK: "1",
      },
    },
  );
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-ss",
    "1",
    "-i",
    video,
    "-frames:v",
    "1",
    path.join(root, "poster.png"),
  ]);
  encodeWebP(path.join(root, "poster.png"), "website/assets/video-poster.webp");
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-ss",
    "50",
    "-i",
    video,
    "-vf",
    "scale=1200:675,crop=1200:630",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "website/assets/social-preview.jpg",
  ]);
}
console.log("Prepared local showcase at .cache/showcase/render");
