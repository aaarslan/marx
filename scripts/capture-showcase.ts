import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeAnimationRuntime, encodeWebP } from "./showcase-assets";
if (process.platform !== "darwin")
  throw new Error("Native showcase capture requires macOS");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("CX_")),
);
const root = fs.mkdtempSync("/tmp/marx-showcase-");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
fs.writeFileSync(
  path.join(root, ".synthetic-marx-fixture"),
  "Synthetic public showcase, no customer data.",
);
const source = path.join(root, "demo-service");
fs.mkdirSync(source, { recursive: true, mode: 0o700 });
fs.writeFileSync(
  path.join(source, "index.js"),
  "const syntheticDemo = true;\n",
);
const profile = path.join(root, "profile");
fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
const go = process.env.GO_EXECUTABLE || Bun.which("go");
if (!go) throw new Error("Go is required");
execFileSync(go, [
  "build",
  "-trimpath",
  "-buildvcs=false",
  "-o",
  path.join(root, "cx"),
  "./scripts/fixtures/cli",
]);
fs.writeFileSync(path.join(root, "cli.yaml"), "{}");
fs.writeFileSync(path.join(root, "showcase"), "Synthetic public product demonstration");
fs.writeFileSync(
  path.join(profile, "settings.json"),
  JSON.stringify({
    cliPath: path.join(root, "cx"),
    cliConfigPath: path.join(root, "cli.yaml"),
    cliAuthMode: "cli",
    recentFolders: [source],
  }),
  { mode: 0o600 },
);
const token = randomBytes(32).toString("hex");
const host = path.join(root, "Marx-showcase-host");
execFileSync(go, [
  "build",
  "-trimpath",
  "-buildvcs=false",
  "-tags",
  "production,acceptance",
  "-ldflags",
  "-extldflags=-mmacosx-version-min=13.0",
  "-o",
  host,
  "./native",
]);
const child = spawn(host, [], {
  env: {
    ...environment,
    MARX_INTEL_FIXTURE: "1",
    MARX_USER_DATA_DIR: profile,
    MARX_FIXTURE_ROOT: root,
    MARX_ACCEPTANCE_PORT: "19334",
    MARX_ACCEPTANCE_TOKEN: token,
    CX_APIKEY: "",
    CX_CONFIG_FILE_PATH: "",
    CX_CLIENT_ID: "",
    CX_CLIENT_SECRET: "",
  },
  stdio: ["ignore", "ignore", "ignore"],
});
const captureDir = path.resolve(".cache/showcase/captured");
fs.mkdirSync(captureDir, { recursive: true });
const evaluate = async (expression: string) => {
  const response = await fetch("http://127.0.0.1:19334/evaluate", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: JSON.stringify({ expression }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error("Native operation failed " + response.status);
  const result = (await response.json()) as any;
  if (result.error) throw new Error(result.error);
  return result.value;
};
const wait = async (expression: string) => {
  const deadline = Date.now() + 20000;
  for (let i = 0; i < 100 && Date.now() < deadline; i++) {
    try {
      if (await evaluate(expression)) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("Showcase state did not settle: " + expression);
};
const view = async (name: string) => {
  await evaluate(
    `Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`,
  );
  await Bun.sleep(250);
};
const capture = async (name: string) => {
  const html = await evaluate(
    `(()=>{const copy=document.documentElement.cloneNode(true);const active=Array.from(document.documentElement.querySelectorAll('*')).indexOf(document.activeElement);if(active>=0)copy.querySelectorAll('*')[active].setAttribute('data-captured-focus','true');copy.querySelectorAll('input').forEach((node,index)=>node.setAttribute('value',document.querySelectorAll('input')[index].value));copy.querySelectorAll('textarea').forEach((node,index)=>node.textContent=document.querySelectorAll('textarea')[index].value);copy.querySelectorAll('option').forEach((node,index)=>{if(document.querySelectorAll('option')[index].selected)node.setAttribute('selected','');else node.removeAttribute('selected')});copy.querySelectorAll('script').forEach(e=>e.remove());return '<!doctype html>'+copy.outerHTML})()`,
  );
  fs.mkdirSync(path.join(captureDir, name), { recursive: true });
  let frozen = html
    .replace(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/gi, "")
    .replace(/<link[^>]+rel="modulepreload"[^>]*>/gi, "")
    .replaceAll("/assets/", "./assets/")
    .replace(
      '<div id="root"',
      '<div data-composition-id="capture" data-width="1280" data-height="840" data-duration="1" id="root"',
    );
  frozen = frozen.replace(
    "</body>",
    `<script src="assets/gsap.min.js"></script><script>document.querySelectorAll('dialog[open]').forEach(d=>{d.removeAttribute('open');d.showModal()});document.querySelector('[data-captured-focus]')?.focus({preventScroll:true});window.__timelines={capture:gsap.timeline({paused:true}).to({clock:0},{clock:1,duration:1})};</script></body>`,
  );
  fs.writeFileSync(path.join(captureDir, name, "index.html"), frozen);
  fs.cpSync(
    "native/frontend/dist/assets",
    path.join(captureDir, name, "assets"),
    { recursive: true },
  );
  console.log("Captured actual app state:", name);
};
try {
  await wait("!!window.marx");
  await evaluate(`window.marx.bindings.save(${JSON.stringify(source)},'p1')`);
  console.log("Importing synthetic findings");
  const large = await evaluate('window.marx.results.get("showcase")');
  console.log("Opening Scan");
  await view("Scan");
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('demo-service'))?.click()`,
  );
  await wait(
    '!!document.querySelector("input[aria-label=Branch]")||document.querySelectorAll("select").length>0',
  );
  await wait(`!!document.querySelector('select[aria-label="Checkmarx One project"] option[value="p1"]') && !document.querySelector('select[aria-label="Checkmarx One project"]').disabled`);
  await capture("scan");
  await view("Results");
  await wait(
    `!!document.querySelector('select[aria-label="Scan"] option[value="showcase"]')`,
  );
  await evaluate(
    `(()=>{const e=document.querySelector('select[aria-label="Scan"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'showcase');e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  );
  await wait('document.querySelectorAll(".finding-link").length===8');
  await capture("results");
  await evaluate('document.querySelector(".finding-link").click()');
  await wait('!!document.querySelector(".investigation-detail")');
  await capture("detail");
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Fix with AI').click()`,
  );
  await wait('!!document.querySelector("dialog[open]")');
  await wait(`Array.from(document.querySelectorAll('dialog button')).some(button=>button.textContent.trim()==='Copy prompt'&&!button.disabled)`);
  await capture("prompt");
  await evaluate(`Array.from(document.querySelectorAll('dialog button')).find(button=>button.textContent.trim()==='Copy prompt').click()`);
  await wait(`Array.from(document.querySelectorAll('dialog button')).some(button=>button.textContent.trim()==='Copied')`);
  await capture("prompt-copied");
  await evaluate(
    `document.querySelector('dialog button[aria-label="Close remediation prompt"]')?.click()`,
  );
  const session = await evaluate(
    `window.marx.workbench.createSession({title:'Parameterize account search',scanId:'showcase',findingIds:${JSON.stringify(large.findings.slice(0, 2).map((f: any) => f.id))}})`,
  );
  await evaluate(
    `window.marx.workbench.updateSession({id:${JSON.stringify(session.id)},notes:'Replace string-concatenated queries with parameterized statements. Keep the original findings pinned, then compare a verification scan.'})`,
  );
  await view("Workbench");
  await wait(
    'document.querySelector("main").textContent.includes("Parameterize account search")',
  );
  await evaluate(`document.querySelector('.session-card').click()`);
  await wait('!!document.querySelector("textarea")');
  await capture("workbench");
  fs.writeFileSync(path.join(root, "intel-demo"), "Synthetic CVE findings");
  const intelPage = await evaluate('window.marx.results.get("intel-demo")');
  await evaluate('window.marx.intelligence.configure(["kev","epss","cve"])');
  await evaluate('window.marx.intelligence.watch("CVE-2024-1234")');
  await evaluate('window.marx.intelligence.watch("CVE-2021-44228")');
  await evaluate(
    'window.marx.intelligence.refresh({cves:["CVE-2024-1234","CVE-2021-44228"],requestId:"showcase-baseline",force:true})',
  );
  await evaluate(
    `window.marx.intelligence.decide(${JSON.stringify({ connectionId: intelPage.connectionId, scanId: "intel-demo", findingId: intelPage.findings[0].id, expectedRevision: 0, verdict: "defer", note: "A compatible dependency update is planned. Revisit this decision if exploitation evidence changes.", reviewAt: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), assumptions: { notInKev: true, epssBelow: 0.1, manual: "Confirm the affected component remains isolated from untrusted input." } })})`,
  );
  await view("CVE intelligence");
  await wait(
    `document.querySelector('.intel-watch')?.textContent.includes('CVE-2021-44228')`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.intel-watch-row button')).find(button=>button.textContent.includes('CVE-2021-44228')).click()`,
  );
  await wait(
    `document.querySelector('.intel-facts')?.textContent.includes('97.00%')`,
  );
  await capture("intelligence");
  await view("Workbench");
  await wait(`!!document.querySelector('#decisions-tab')`);
  await evaluate(`document.querySelector('#decisions-tab').click()`);
  await wait(`!!document.querySelector('.session-list .session-card')`);
  await evaluate(`document.querySelector('.session-list .session-card').click()`);
  await wait(`document.querySelector('.decision-detail')?.textContent.includes('Decision history (1 revision)')`);
  await capture("decision-baseline");
  await view("CVE intelligence");
  fs.writeFileSync(
    path.join(root, "intel-escalate"),
    "Synthetic changed evidence",
  );
  await evaluate(
    'window.marx.intelligence.refresh({cves:["CVE-2024-1234"],requestId:"showcase-changed-evidence",force:true})',
  );
  await view("Workbench");
  await wait(`!!document.querySelector('#decisions-tab')`);
  await evaluate(`document.querySelector('#decisions-tab').click()`);
  await wait(
    `document.querySelector('.session-list')?.textContent.includes('needs review')`,
  );
  await evaluate(`document.querySelector('.session-card').click()`);
  await wait(
    `document.querySelector('.decision-detail')?.textContent.includes('EPSS has reached')`,
  );
  await wait(
    `document.querySelector('.decision-detail')?.textContent.includes('Decision history (1 revision)')`,
  );
  await capture("decisions");
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const done = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await done;
  }
}

const binary = process.env.HYPERFRAMES_EXECUTABLE;
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
]) {
  await writeAnimationRuntime(
    path.join(captureDir, name, "assets/gsap.min.js"),
  );
  const args = [
    "snapshot",
    path.join(captureDir, name),
    "--at",
    "0",
    "--no-end",
    "--output",
    path.resolve(`.cache/showcase/still-${name}`),
    "--json",
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
  encodeWebP(
    path.resolve(`.cache/showcase/still-${name}/frame-00-at-0s.png`),
    `website/assets/${name}.webp`,
  );
}
console.log("Captured and encoded nine synthetic native application states.");
