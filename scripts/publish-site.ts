import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const gitEnvironment = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
};

function git(args: string[], input?: string | Buffer, env = gitEnvironment) {
  return execFileSync("git", args, {
    input,
    env,
    encoding: "utf8",
    timeout: 60000,
  }).trim();
}

if (git(["status", "--porcelain"]) !== "")
  throw new Error(
    "Commit or set aside working changes before publishing the website",
  );
const remote = git(["remote", "get-url", "origin"]);
if (
  !/^(https:\/\/github\.com\/aaarslan\/marx(?:\.git)?|git@github\.com:aaarslan\/marx(?:\.git)?)$/.test(
    remote,
  )
)
  throw new Error(
    "Publish is configured for the Marx repository; update the repository URLs before publishing a fork",
  );
const [name, email] = git(["log", "-1", "--format=%an%n%ae"]).split("\n");
if (!email.endsWith("@users.noreply.github.com"))
  throw new Error("Use a GitHub noreply commit identity before publishing");
execFileSync("bun", ["scripts/build-site.ts"], { stdio: "inherit" });
const revision = git(["rev-parse", "HEAD"]);
const previous = git([
  "ls-remote",
  "--heads",
  "origin",
  "refs/heads/gh-pages",
]).split(/\s/)[0];
if (previous) git(["fetch", "--no-tags", "origin", "gh-pages"]);
const temporary = fs.mkdtempSync(path.resolve(".cache/site-publish-"));
const date = new Date().toISOString();
const env = {
  ...gitEnvironment,
  GIT_INDEX_FILE: path.join(temporary, "index"),
  GIT_AUTHOR_NAME: name,
  GIT_AUTHOR_EMAIL: email,
  GIT_COMMITTER_NAME: name,
  GIT_COMMITTER_EMAIL: email,
  GIT_AUTHOR_DATE: date,
  GIT_COMMITTER_DATE: date,
};
const root = path.resolve(".cache/website");
try {
  git(["read-tree", "--empty"], undefined, env);
  const files = fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((file) => file.isFile());
  const records = files.map((file) => {
    const source = path.join(file.parentPath, file.name);
    const relative = path.relative(root, source).split(path.sep).join("/");
    const blob = git(["hash-object", "-w", "--stdin"], fs.readFileSync(source));
    return `100644 ${blob}\t${relative}\n`;
  });
  git(["update-index", "--index-info"], records.join(""), env);
  const tree = git(["write-tree"], undefined, env);
  if (previous && git(["rev-parse", `${previous}^{tree}`]) === tree) {
    console.log("Published website already matches this revision.");
  } else {
    const commit = git(
      ["commit-tree", tree, ...(previous ? ["-p", previous] : [])],
      `Publish Marx website from ${revision}\n`,
      env,
    );
    execFileSync("git", ["push", "origin", `${commit}:refs/heads/gh-pages`], {
      stdio: "inherit",
      env: gitEnvironment,
      timeout: 120000,
    });
    console.log(`Website branch published from source ${revision}.`);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
