import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const root = path.resolve(".cache/website");
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const publicFiles = [
  "index.html",
  "walkthrough.html",
  "404.html",
  "site.css",
  "site.js",
  "icon.png",
  ".nojekyll",
  ...[
    "detail.webp",
    "intelligence.webp",
    "decisions.webp",
    "decision-baseline.webp",
    "marx-showcase.mp4",
    "prompt.webp",
    "results.webp",
    "scan.webp",
    "showcase.vtt",
    "social-preview.jpg",
    "video-poster.webp",
    "workbench.webp",
  ].map((name) => `assets/${name}`),
];
for (const name of publicFiles) {
  const source = path.join("website", name);
  if (!fs.lstatSync(source).isFile())
    throw new Error(`Public asset must be a regular file: ${name}`);
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.copyFileSync(source, path.join(root, name));
}
for (const name of ["index.html", "walkthrough.html"]) {
  const file = path.join(root, name);
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replaceAll(
        "https://github.com/aaarslan/marx/blob/main/",
        `https://github.com/aaarslan/marx/blob/${revision}/`,
      ),
  );
}
fs.writeFileSync(
  path.join(root, "source.json"),
  JSON.stringify(
    { repository: "https://github.com/aaarslan/marx", revision },
    null,
    2,
  ) + "\n",
);
execFileSync("bun", ["scripts/verify-site.ts", root], { stdio: "inherit" });
console.log(
  "Static website prepared in .cache/website with documentation links pinned to its source commit.",
);
