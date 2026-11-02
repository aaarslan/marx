import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(process.argv[2] || "website");
for (const name of ["index.html", "walkthrough.html", "404.html"]) {
  const html = fs.readFileSync(path.join(root, name), "utf8");
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  for (const match of html.matchAll(/(?:src|href|poster)="([^"]+)"/g)) {
    const value = match[1];
    if (/^(https?:|data:)/.test(value)) continue;
    assert.ok(
      !value.startsWith("/"),
      `Repository-prefix incompatible URL: ${value}`,
    );
    const [file, fragment] = value.split("#");
    let target = path.resolve(root, file || name);
    if (target === root) target = path.join(root, "index.html");
    assert.ok(
      target.startsWith(root + path.sep),
      `Resource escapes site: ${value}`,
    );
    assert.ok(fs.existsSync(target), `Missing site resource: ${value}`);
    if (fragment)
      assert.ok(
        fs.readFileSync(target, "utf8").includes(`id="${fragment}"`),
        `Missing anchor: ${value}`,
      );
  }
  for (const match of html.matchAll(/<img\b([^>]+)>/g))
    assert.match(match[1], /alt="[^"]*"/);
}
const landing = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.ok(
  !/<video[^>]*\bautoplay/.test(landing),
  "Video must require explicit playback",
);
assert.match(landing, /<track[^>]+kind="captions"/);
assert.match(landing, /Content-Security-Policy/);
assert.ok(
  fs.statSync(path.join(root, "assets/marx-showcase.mp4")).size <
    20 * 1024 * 1024,
  "Showcase exceeds site media budget",
);
console.log(
  "Landing and guide resources, anchors, repository-relative URLs, image alternatives and explicit video controls verified.",
);
