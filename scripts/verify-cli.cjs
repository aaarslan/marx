const { app, BrowserWindow, clipboard, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-cli-acceptance-'));
const profile = path.join(folder, 'profile');
const source = path.join(folder, 'source with spaces');
const executable = path.join(folder, process.platform === 'win32' ? 'cx.exe' : 'cx');
const receipt = path.join(folder, 'calls.jsonl');
const obsolete = path.join(folder, 'obsolete');
const holdSubmission = path.join(folder, 'hold-submission');
const config = path.join(folder, 'cli-config.yaml');
const counter = path.join(folder, 'scan-counter');
const changedEvidence = path.join(folder, 'changed-evidence');
const workspace = path.join(folder, 'nested workspace');
const workspaceWeb = path.join(workspace, 'apps', 'frontend');
const workspaceCore = path.join(workspace, 'packages', 'nested', 'core');
fs.writeFileSync(config, 'tenant: synthetic-fixture\n');
fs.mkdirSync(profile);
fs.mkdirSync(source);
fs.writeFileSync(path.join(source, 'package.json'), '{"name":"synthetic-fixture"}');
fs.writeFileSync(path.join(source, 'index.js'), 'const synthetic = true;');
fs.mkdirSync(workspaceWeb, { recursive: true });
fs.mkdirSync(workspaceCore, { recursive: true });
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'synthetic-workspace', private: true, workspaces: ['apps/*', 'packages/*/*'] }));
fs.writeFileSync(path.join(workspaceWeb, 'package.json'), JSON.stringify({ name: 'synthetic-web', dependencies: { 'synthetic-core': 'workspace:*' } }));
fs.writeFileSync(path.join(workspaceCore, 'package.json'), JSON.stringify({ name: 'synthetic-core' }));
fs.writeFileSync(path.join(workspaceWeb, 'index.js'), 'const web = true;');
fs.writeFileSync(path.join(workspaceCore, 'index.js'), 'const core = true;');
const node = process.platform === 'win32' ? '' : require('node:child_process').execFileSync('which', ['node'], { encoding: 'utf8' }).trim();
const mockScript = process.platform === 'win32' ? path.join(folder, 'cx.js') : executable;
fs.writeFileSync(mockScript, `${process.platform === 'win32' ? '' : '#!' + node}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const value = (name) => args.find((arg) => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
fs.appendFileSync(${JSON.stringify(receipt)}, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
const project = { ID: 'p1', Name: 'synthetic-fixture', MainBranch: 'main' };
const scan = { ID: 's1', ProjectID: 'p1', ProjectName: 'synthetic-fixture', Branch: 'master', Status: 'Completed', CreatedAt: '2026-10-30T12:00:00Z' };
if (args.includes('--help')) {
  const flags = ['debug', 'retry', 'config-file-path', 'format', 'filter', 'project-id', 'file-source', 'project-name', 'branch', 'scan-types', 'async', 'scan-info-format', 'skip-default-filter', 'file-filter', 'file-filter-ext', 'exclude-git-folder', 'sast-incremental', 'sast-preset-name', 'sca-exploitable-path', 'base-branch', 'tags', 'scan-id', 'report-format', 'output-name', 'output-path'];
  console.log('Usage: cx ' + args.slice(0, -1).join(' ') + '\\nFlags:\\n' + flags.filter(flag => !fs.existsSync(${JSON.stringify(obsolete)}) || flag !== 'scan-info-format').map(flag => '  --' + flag + ' string   Synthetic capability').join('\\n'));
}
else if (args[0] === 'version') console.log('2.3.69-synthetic');
else if (args[0] === 'auth') console.log('Authenticated');
else if (args[0] === 'project' && args[1] === 'show') console.log(JSON.stringify(project));
else if (args[0] === 'project') console.log(JSON.stringify([project]));
else if (args[0] === 'scan' && args[1] === 'create') {
  if (!fs.existsSync(path.join(value('file-source'), 'index.js'))) process.exit(2);
  if (value('project-name') === 'failure') { console.error('Synthetic upload rejected (401)'); process.exit(1); }
  const number = Number(fs.existsSync(${JSON.stringify(counter)}) ? fs.readFileSync(${JSON.stringify(counter)}, 'utf8') : 0) + 1;
  fs.writeFileSync(${JSON.stringify(counter)}, String(number));
  scan.ID = 's' + number;
  if (number > 1) scan.CreatedAt = '2026-10-31T12:00:00Z';
  console.error('CLI preparing and uploading synthetic source');
  if (fs.existsSync(${JSON.stringify(holdSubmission)})) {
    let count = 0;
    const timer = setInterval(() => {
      if (++count > 200) { console.error('Synthetic submission hold timed out'); process.exit(1); }
      console.error('Synthetic live progress ' + count);
      if (!fs.existsSync(${JSON.stringify(holdSubmission)})) { clearInterval(timer); console.log(JSON.stringify(scan)); }
    }, 50);
  } else console.log(JSON.stringify(scan));
}
else if (args[0] === 'scan' && args[1] === 'list') console.log(JSON.stringify([...(Number(fs.existsSync(${JSON.stringify(counter)}) ? fs.readFileSync(${JSON.stringify(counter)}, 'utf8') : 0) > 1 ? [{ ...scan, ID: 's2', CreatedAt: '2026-10-31T12:00:00Z' }] : []), scan, { ...scan, ID: 'baseline', CreatedAt: '2026-10-29T12:00:00Z' }, { ...scan, ID: 'cross-branch', Branch: 'feature', CreatedAt: '2026-10-28T12:00:00Z' }, { ...scan, ID: 'wrong-project', ProjectID: 'p2', CreatedAt: '2026-10-27T12:00:00Z' }]));
else if (args[0] === 'scan' && args[1] === 'show') console.log(JSON.stringify(value('scan-id') === 's1' ? scan : value('scan-id') === 's2' ? { ...scan, ID: 's2', CreatedAt: '2026-10-31T12:00:00Z' } : { ...scan, ID: value('scan-id'), Branch: value('scan-id') === 'cross-branch' ? 'feature' : scan.Branch, CreatedAt: '2026-10-28T12:00:00Z' }));
else if (args[0] === 'scan' && args[1] === 'cancel') console.log('Canceled');
else if (args[0] === 'results') {
  const count = value('scan-id') === 'large-paging' ? 5051 : value('scan-id') === 's2' ? 0 : value('scan-id') === 's1' && fs.existsSync(${JSON.stringify(changedEvidence)}) ? 20 : 21;
  const report = value('report-format') === 'summaryJSON'
    ? { CriticalIssues: 0, HighIssues: count, MediumIssues: 0, LowIssues: 0, InfoIssues: 0 }
    : { scanID: value('scan-id'), totalCount: count, results: Array.from({ length: count }, (_, index) => ({ id: 'finding-' + (index + 1), similarityId: 'stable-' + (index + 1), type: 'sast', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW', data: { queryName: index ? 'Synthetic injection ' + (index + 1) : 'Synthetic injection', nodes: [{ fileName: 'index.js', line: 1 }] } })) };
  fs.writeFileSync(path.join(value('output-path'), value('report-format') === 'sarif' ? 'report.sarif' : 'report.json'), JSON.stringify(value('report-format') === 'sarif' ? { version: '2.1.0', runs: [{ tool: { driver: { name: 'Synthetic CLI' } }, results: [] }] } : report));
  console.log('Report created');
}
else process.exit(3);
`, { mode: 0o700 });
if (process.platform === 'win32') require('node:child_process').execFileSync('bun', ['build', mockScript, '--compile', '--outfile', executable], { stdio: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ cliPath: executable, cliConfigPath: config, cliAuthMode: 'cli', recentFolders: [fs.realpathSync(source)] }));
let copiedPrompt = '';
const promptFile = path.join(folder, 'remediation.md');
clipboard.writeText = (text) => { copiedPrompt = text; };
let pendingSave = null;
let selectedFolder = null;
dialog.showOpenDialog = async () => selectedFolder ? { canceled: false, filePaths: [selectedFolder] } : { canceled: true, filePaths: [] };
dialog.showSaveDialog = async () => pendingSave ? new Promise((resolve) => { pendingSave.resolve = resolve; }) : ({ canceled: false, filePath: promptFile });
app.setPath('userData', profile);
if (process.platform === 'darwin') app.on('browser-window-created', (_event, win) => { win.on('show', () => win.hide()); });
require(process.env.MARX_ACCEPTANCE_BUNDLE ? path.join(process.env.MARX_ACCEPTANCE_BUNDLE, 'out/main/index.js') : '../out/main/index.js');

async function waitFor(contents, expression) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { if (await contents.executeJavaScript(expression)) return; } catch (error) { throw new Error(`Failed predicate: ${expression}`, { cause: error }); }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${expression}`);
}

async function clickText(contents, text, selector = 'button') {
  await contents.executeJavaScript(`(() => { const target = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(element => element.textContent.trim() === ${JSON.stringify(text)}); if (!target) throw new Error('Missing action: ' + ${JSON.stringify(text)}); target.click(); })()`);
}

async function setControl(contents, label, value) {
  await contents.executeJavaScript(`(() => { const element = Array.from(document.querySelectorAll('input, select, textarea')).find(item => item.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!element) throw new Error('Missing control'); const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); })()`);
}

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const contents = win.webContents;
  contents.on('console-message', (event) => { if (event.level === 'error' || event.level === 3) console.error(`Renderer: ${event.message}`); });
  try {
    contents.setBackgroundThrottling(false);
    await waitFor(contents, 'Boolean(document.querySelector(".nav-item"))');
    contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Page.enable');
    await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.scanRenderCounts = { shell: 0, commits: 0 };
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        inject: () => 1,
        onCommitFiberRoot: (_id, root) => {
          window.scanRenderCounts.commits++;
          let fiber = root.current.child;
          while (fiber && fiber.tag !== 0) fiber = fiber.child;
          if (fiber && (fiber.flags & 1)) window.scanRenderCounts.shell++;
        },
        onCommitFiberUnmount: () => {}
      };
    ` });
    contents.reload();
    await waitFor(contents, 'Boolean(document.querySelector(".nav-item")) && window.scanRenderCounts?.commits > 0');
    assert.equal(win.getBackgroundColor().toLowerCase(), '#17181c');
    assert.equal(await contents.executeJavaScript('getComputedStyle(document.querySelector(".app")).backdropFilter'), 'none');
    await contents.executeJavaScript(`window.acceptanceSource = ${JSON.stringify(fs.realpathSync(source))}; window.acceptanceEvents = []; window.marx.onScanEvent(event => window.acceptanceEvents.push(event)); void 0;`);
    const settings = await contents.executeJavaScript('window.marx.settings.get()');
    assert.equal(settings.hasApiKey, false);
    const connection = await contents.executeJavaScript('window.marx.settings.testConnection()');
    assert.equal(connection.ok, true);
    assert.equal(connection.cliPath, executable);
    await contents.executeJavaScript(`Array.from(document.querySelectorAll('.nav-item')).find(button => button.textContent.trim() === 'Settings').click()`);
    await waitFor(contents, 'Boolean(document.querySelector("input[aria-label=\\"CLI executable\\"]"))');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Test CLI connection").click()');
    await waitFor(contents, 'document.body.textContent.includes("authentication and project access verified")');
    for (const width of [1280, 960]) {
      win.setSize(width, 840);
      await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const layout = await contents.executeJavaScript('({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, input: document.querySelector("input[aria-label=\\"CLI executable\\"]").getBoundingClientRect().width })');
      assert.ok(layout.scroll <= layout.width, JSON.stringify(layout));
      assert.ok(layout.input > 100);
      const image = await contents.capturePage();
      fs.writeFileSync(path.join(folder, `settings-${width}.png`), image.toPNG());
    }
    await contents.executeJavaScript(`Array.from(document.querySelectorAll('.nav-item')).find(button => button.textContent.trim() === 'Results').click()`);
    await waitFor(contents, 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "Load demo results")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Load demo results").click()');
    await waitFor(contents, 'document.querySelectorAll(".finding-link").length === 9');
    await contents.executeJavaScript('(() => { const button = Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Fix with AI"); button.focus(); button.click(); })()');
    await waitFor(contents, 'Boolean(document.querySelector(".remediation-dialog[open]"))');
    const preview = await contents.executeJavaScript('document.querySelector(".remediation-preview").value');
    assert.ok(preview.includes('synthetic demo findings'));
    assert.ok(preview.includes('"severity": "HIGH"'));
    assert.ok(!preview.includes('"severity": "LOW"'));
    assert.equal(await contents.executeJavaScript('window.marx.remediation.copy("").then(() => false, error => error.message.includes("empty"))'), true);
    assert.equal(await contents.executeJavaScript('window.marx.remediation.copy("â‚¬".repeat(2800000)).then(() => false, error => error.message.includes("8 MiB"))'), true);
    pendingSave = {};
    await contents.executeJavaScript('window.pendingPromptSave = window.marx.remediation.save({ text: "Canceled prompt", suggestedName: "canceled" }); void 0;');
    const saveDeadline = Date.now() + 3000;
    while (!pendingSave.resolve && Date.now() < saveDeadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(pendingSave.resolve);
    assert.equal(await contents.executeJavaScript('window.marx.remediation.save({ text: "Duplicate", suggestedName: "duplicate" }).then(() => false, error => error.message.includes("already open"))'), true);
    pendingSave.resolve({ canceled: true });
    pendingSave = null;
    assert.equal(await contents.executeJavaScript('window.pendingPromptSave'), null);
    assert.equal(fs.existsSync(promptFile), false);
    await contents.executeJavaScript('Array.from(document.querySelectorAll("dialog button")).find(button => button.textContent.trim() === "Copy prompt").click()');
    await waitFor(contents, 'document.querySelector(".remediation-feedback")?.textContent.includes("copied")');
    assert.equal(copiedPrompt, preview);
    await contents.executeJavaScript('Array.from(document.querySelectorAll("dialog button")).find(button => button.textContent.trim() === "Save prompt").click()');
    await waitFor(contents, 'document.querySelector(".remediation-feedback")?.textContent.includes("Saved")');
    assert.equal(fs.readFileSync(promptFile, 'utf8'), preview);
    await contents.executeJavaScript('Array.from(document.querySelectorAll("dialog button")).find(button => button.textContent.trim() === "None").click()');
    await waitFor(contents, 'document.querySelector(".remediation-empty")?.textContent.includes("No findings")');
    assert.equal(await contents.executeJavaScript('Array.from(document.querySelectorAll("dialog button")).find(button => button.textContent.trim() === "Copy prompt").disabled'), true);
    await contents.executeJavaScript('Array.from(document.querySelectorAll("dialog button")).find(button => button.textContent.trim() === "All").click()');
    await waitFor(contents, 'document.querySelector(".remediation-preview-heading").textContent.includes("9 findings selected")');
    for (const width of [1280, 960]) {
      win.setSize(width, 840);
      await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const layout = await contents.executeJavaScript('(() => { const dialog = document.querySelector("dialog"); const select = dialog.querySelector("select"); const style = getComputedStyle(select); return { width: dialog.clientWidth, scroll: dialog.scrollWidth, padding: parseFloat(style.paddingRight), position: style.backgroundPositionX, appearance: style.appearance }; })()');
      assert.ok(layout.scroll <= layout.width, JSON.stringify(layout));
      assert.ok(layout.padding >= 32, JSON.stringify(layout));
      assert.equal(layout.appearance, 'none');
      const image = await contents.capturePage();
      fs.writeFileSync(path.join(folder, `remediation-${width}.png`), image.toPNG());
    }
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(contents, '!document.querySelector(".remediation-dialog")');
    assert.equal(await contents.executeJavaScript('document.activeElement.textContent.trim()'), 'Fix with AI');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.getAttribute("aria-label")?.startsWith("Low severity,")).click()');
    await waitFor(contents, 'document.querySelectorAll(".finding-link").length === 2');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Fix with AI").click()');
    await waitFor(contents, 'document.querySelector("dialog select")?.value === "filtered"');
    const lowPreview = await contents.executeJavaScript('document.querySelector(".remediation-preview").value');
    assert.ok(lowPreview.includes('"severity": "LOW"') && !lowPreview.includes('"severity": "HIGH"'));
    await contents.executeJavaScript('(() => { const select = Array.from(document.querySelectorAll("dialog select")).find(select => select.getAttribute("aria-label") === "Coding assistant"); select.value = "generic"; select.dispatchEvent(new Event("change", { bubbles: true })); })()');
    await waitFor(contents, 'document.querySelector(".remediation-preview").value.includes("coding assistant that can inspect and edit")');
    await contents.executeJavaScript('document.querySelector("dialog .remediation-heading button").click()');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Clear filters").click()');
    await waitFor(contents, 'document.querySelectorAll(".finding-link").length === 9');
    await contents.executeJavaScript('Array.from(document.querySelectorAll(".finding-link")).find(button => button.textContent === "Log_Forcing").click()');
    await waitFor(contents, 'Boolean(document.querySelector(".finding-heading"))');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Fix with AI").click()');
    await waitFor(contents, 'document.querySelector("dialog select")?.value === "finding"');
    const singlePreview = await contents.executeJavaScript('document.querySelector(".remediation-preview").value');
    assert.equal((singlePreview.match(/"findingId":/g) ?? []).length, 1);
    assert.ok(singlePreview.includes('"title": "Log_Forcing"'));
    await contents.executeJavaScript('document.querySelector("dialog .remediation-heading button").click()');
    await contents.executeJavaScript(`Array.from(document.querySelectorAll('.nav-item')).find(button => button.textContent.trim() === 'Scan').click()`);
    await waitFor(contents, 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "source with spaces")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "source with spaces").click()');
    await waitFor(contents, 'Boolean(document.querySelector("select[aria-label=\\"Checkmarx One project\\"]"))');
    assert.equal(await contents.executeJavaScript('document.querySelector("select[aria-label=\\"Checkmarx One project\\"]").value'), '');
    assert.equal(await contents.executeJavaScript('window.marx.scan.run({ folderPath: window.acceptanceSource, projectId: "p1", projectName: "synthetic-fixture", options: {} }).then(() => false, error => error.message.includes("mapping"))'), true);
    await contents.executeJavaScript('(() => { const select = document.querySelector("select[aria-label=\\"Checkmarx One project\\"]"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "p1"); select.dispatchEvent(new Event("change", { bubbles: true })); })()');
    await waitFor(contents, 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.includes("Run scan") && !button.disabled)');
    for (const width of [1280, 960]) {
      win.setSize(width, 840);
      await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      assert.equal(await contents.executeJavaScript('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
      fs.writeFileSync(path.join(folder, `mapping-${width}.png`), (await contents.capturePage()).toPNG());
    }
    fs.writeFileSync(holdSubmission, 'hold');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Run scan") && !button.disabled).click()');
    await waitFor(contents, 'document.querySelector(".log-box")?.textContent.includes("Synthetic live progress 3")');
    const liveLayout = await contents.executeJavaScript(`(() => {
      const panel = document.querySelector('.progress-card');
      const main = document.querySelector('main');
      main.scrollTop += panel.getBoundingClientRect().top - main.getBoundingClientRect().top - main.clientHeight / 3;
      window.scanFocusElement = document.querySelector('input[value="master"]');
      window.scanFocusElement.focus({ preventScroll: true });
      window.scanRenderCounts.shell = 0;
      return { height: document.querySelector('.log-box').getBoundingClientRect().height, scroll: document.querySelector('main').scrollTop, elapsed: panel.querySelector('.row .faint.mono:last-child').textContent };
    })()`);
    await waitFor(contents, 'document.querySelector(".log-box")?.textContent.includes("Synthetic live progress 25")');
    const liveShellRenders = await contents.executeJavaScript('window.scanRenderCounts.shell');
    console.log(JSON.stringify({ liveShellRenders }));
    assert.equal(liveShellRenders, 0, 'CLI logs must not rerender the application shell');
    const liveAfter = await contents.executeJavaScript(`({ height: document.querySelector('.log-box').getBoundingClientRect().height, scroll: document.querySelector('main').scrollTop, elapsed: document.querySelector('.progress-card .row .faint.mono:last-child').textContent, focusPreserved: document.activeElement === window.scanFocusElement, scrolls: document.querySelector('.log-box').scrollHeight > document.querySelector('.log-box').clientHeight })`);
    assert.equal(liveAfter.height, liveLayout.height);
    assert.equal(liveAfter.scroll, liveLayout.scroll);
    assert.equal(liveAfter.focusPreserved, true);
    assert.equal(liveAfter.scrolls, true);
    assert.notEqual(liveAfter.elapsed, liveLayout.elapsed);
    fs.writeFileSync(path.join(folder, 'live-scan.png'), (await contents.capturePage()).toPNG());
    await contents.executeJavaScript(`Array.from(document.querySelectorAll('.nav-item')).find(button => button.textContent.trim() === 'Settings').click()`);
    await waitFor(contents, 'Boolean(document.querySelector("input[aria-label=\\"CLI executable\\"]"))');
    await contents.executeJavaScript('document.querySelector("input[aria-label=\\"CLI executable\\"]").focus(); window.scanRenderCounts.shell = 0');
    await waitFor(contents, 'document.querySelector(".log-box")?.textContent.includes("Synthetic live progress 50")');
    assert.equal(await contents.executeJavaScript('window.scanRenderCounts.shell'), 0);
    assert.equal(await contents.executeJavaScript('document.activeElement === document.querySelector("input[aria-label=\\"CLI executable\\"]")'), true);
    await contents.executeJavaScript(`Array.from(document.querySelectorAll('.nav-item')).find(button => button.textContent.trim() === 'Scan').click()`);
    fs.rmSync(holdSubmission);

    await waitFor(contents, 'window.acceptanceEvents.some(event => event.kind === "job-updated" && event.job.progress.phase === "completed")');
    const events = await contents.executeJavaScript('window.acceptanceEvents');
    const completed = events.find((event) => event.kind === 'job-updated' && event.job.progress.phase === 'completed').job;
    assert.equal(completed.scanId, 's1');
    assert.equal(completed.summary.HIGH, 21);
    assert.ok(events.some((event) => event.kind === 'log' && event.line.includes('CLI preparing')));
    await waitFor(contents, 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "View results")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "View results").click()');
    await waitFor(contents, 'document.body.textContent.includes("Synthetic injection")');
    assert.equal((await contents.executeJavaScript('window.marx.results.get("s1")')).findings[0].title, 'Synthetic injection');
    await contents.executeJavaScript('(() => { const button = Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Fix with AI"); button.focus(); button.click(); })()');
    await waitFor(contents, 'document.querySelector("dialog")?.textContent.includes("Batch 1 of 2")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("dialog button")).find(button => button.textContent.trim() === "Copy this batch").click()');
    await waitFor(contents, 'document.querySelector(".remediation-feedback")?.textContent.includes("copied")');
    assert.ok(copiedPrompt.includes('"findingId": "finding-20"'));
    assert.ok(!copiedPrompt.includes('"findingId": "finding-21"'));
    await contents.executeJavaScript('document.querySelector("button[aria-label=\\"Next prompt batch\\"]").click()');
    await waitFor(contents, 'document.querySelector(".remediation-preview").value.includes("Finding 21")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("dialog button")).find(button => button.textContent.trim() === "Copy this batch").click()');
    await waitFor(contents, 'document.querySelector(".remediation-feedback")?.textContent.includes("Batch 2 copied")');
    assert.ok(copiedPrompt.includes('"findingId": "finding-21"'));
    assert.ok(!copiedPrompt.includes('"findingId": "finding-20"'));
    await contents.executeJavaScript('Array.from(document.querySelectorAll("dialog button")).find(button => button.textContent.trim() === "Save all batches").click()');
    await waitFor(contents, 'document.querySelector(".remediation-feedback")?.textContent.includes("Saved 2 batches")');
    const allPrompts = fs.readFileSync(promptFile, 'utf8');
    assert.ok(allPrompts.includes('"findingId": "finding-1"') && allPrompts.includes('"findingId": "finding-21"'));
    await contents.executeJavaScript('document.querySelector("dialog .remediation-heading button").click()');
    const calls = fs.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter((call) => call.args[0] === 'scan' && call.args[1] === 'create' && !call.args.includes('--help')).length, 1);
    const scanCall = calls.find((call) => call.args[0] === 'scan' && call.args[1] === 'create' && !call.args.includes('--help'));
    assert.ok(scanCall.args.includes(`--file-source=${fs.realpathSync(source)}`));
    assert.ok(scanCall.args.includes('--scan-types=sast,sca'));
    assert.ok(scanCall.args.includes('--sast-incremental=true'));
    assert.ok(scanCall.args.includes('--exclude-git-folder'));
    const mapping = await contents.executeJavaScript('window.marx.bindings.get(window.acceptanceSource)');
    assert.equal(mapping.projectId, 'p1');
    assert.equal((JSON.parse(fs.readFileSync(path.join(profile, 'repository-bindings.json'), 'utf8')))[0].folderPath, fs.realpathSync(source));
    assert.equal(await contents.executeJavaScript('document.querySelector("select[aria-label=\\"Baseline scan\\"]").value'), '');
    assert.deepEqual(await contents.executeJavaScript('Array.from(document.querySelector("select[aria-label=\\"Baseline scan\\"]").options).map(option => option.value)'), ['', 'baseline']);
    await contents.executeJavaScript('Array.from(document.querySelectorAll("label")).find(label => label.textContent.includes("Show other branches")).querySelector("input").click()');
    await waitFor(contents, 'document.querySelector("select[aria-label=\\"Baseline scan\\"]").options.length === 3');
    assert.equal(await contents.executeJavaScript('document.querySelector("select[aria-label=\\"Baseline scan\\"]").value'), '');
    await contents.executeJavaScript('(() => { const select = document.querySelector("select[aria-label=\\"Baseline scan\\"]"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "cross-branch"); select.dispatchEvent(new Event("change", { bubbles: true })); })()');
    await waitFor(contents, 'document.body.textContent.includes("persistent") && document.body.textContent.includes("inconclusive")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("label")).find(label => label.textContent.includes("Show other branches")).querySelector("input").click()');
    await waitFor(contents, 'document.querySelector("select[aria-label=\\"Baseline scan\\"]").value === ""');
    for (const width of [1280, 960]) {
      win.setSize(width, 840);
      await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      assert.equal(await contents.executeJavaScript('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
      fs.writeFileSync(path.join(folder, `baseline-${width}.png`), (await contents.capturePage()).toPNG());
    }
    await contents.executeJavaScript('document.querySelectorAll(".finding-link")[0].click()');
    await waitFor(contents, 'document.querySelector(".finding-heading")?.textContent === "Synthetic injection"');
    assert.equal(await contents.executeJavaScript('document.querySelectorAll(".finding-link").length'), 21, 'Opening detail preserves the list');
    win.setSize(1440, 1000);
    await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const initialWidth = await contents.executeJavaScript('Number(document.querySelector(".detail-resizer").getAttribute("aria-valuenow"))');
    await contents.executeJavaScript('document.querySelector(".detail-resizer").focus()');
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await waitFor(contents, `Number(document.querySelector('.detail-resizer').getAttribute('aria-valuenow')) < ${initialWidth}`);
    await contents.executeJavaScript('document.querySelector(".finding-heading").focus()');
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Down', modifiers: ['alt'] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Down', modifiers: ['alt'] });
    await waitFor(contents, 'document.querySelector(".finding-heading")?.textContent === "Synthetic injection 2"');
    await setControl(contents, 'Search findings', 'Synthetic injection');
    await clickText(contents, 'History', '.nav-item');
    await waitFor(contents, `Boolean(document.querySelector('[aria-label="History project"]'))`);
    await clickText(contents, 'Results', '.nav-item');
    await waitFor(contents, 'document.querySelector(".finding-heading")?.textContent === "Synthetic injection 2"');
    assert.equal(await contents.executeJavaScript(`document.querySelector('[aria-label="Search findings"]').value`), 'Synthetic injection');
    win.setMinimumSize(600, 500);
    win.setSize(960, 640);
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await contents.executeJavaScript('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    assert.equal(await contents.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches'), true);
    assert.equal(await contents.executeJavaScript('(() => { const item = document.createElement("span"); item.className = "spin"; document.body.append(item); const animation = getComputedStyle(item).animationName; item.remove(); return animation; })()'), 'none');
    fs.writeFileSync(path.join(folder, 'results-960x640.png'), (await contents.capturePage()).toPNG());
    win.setSize(1440, 1000);
    await contents.executeJavaScript('document.querySelector("main").scrollTop = 0; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(folder, 'workbench-results.png'), (await contents.capturePage()).toPNG());
    await clickText(contents, 'All findings');
    await clickText(contents, 'Clear filters');
    await clickText(contents, 'Group by fix');
    await waitFor(contents, 'document.querySelectorAll(".remediation-group").length > 0');
    assert.ok(await contents.executeJavaScript('Array.from(document.querySelectorAll(".remediation-group .field-help")).every(element => element.textContent.length > 10)'));
    await clickText(contents, 'Group by fix');
    await clickText(contents, 'Fix with AI');
    await waitFor(contents, 'Boolean(document.querySelector(".remediation-dialog[open]"))');
    await clickText(contents, 'Track remediation', 'dialog button');
    await waitFor(contents, `Boolean(document.querySelector('[aria-label="Remediation title"]'))`);
    const createdSession = (await contents.executeJavaScript('window.marx.workbench.bootstrap()')).sessions[0];
    assert.equal(createdSession.findingIds.length, 21);
    assert.ok(createdSession.handoff.includes('"findingId": "finding-21"'));
    await setControl(contents, 'Remediation title', 'Synthetic injection remediation');
    await setControl(contents, 'Change reference', 'feature/synthetic-fix');
    await setControl(contents, 'Remediation notes', 'Reviewed the synthetic source-to-sink evidence.');
    await setControl(contents, 'Local validation', 'Synthetic fixture only. No customer source or live tenant used.');
    await clickText(contents, 'Save notes');
    await waitFor(contents, `window.marx.workbench.bootstrap().then(data => data.sessions.find(item => item.id === ${JSON.stringify(createdSession.id)})?.checks.includes('No customer source'))`);
    fs.writeFileSync(changedEvidence, 'refresh live snapshot');
    const refreshedBaseline = await contents.executeJavaScript('window.marx.results.get("s1", { refresh: true })');
    assert.equal(refreshedBaseline.findings.length, 20);
    assert.equal((await contents.executeJavaScript(`window.marx.workbench.evidence(${JSON.stringify(createdSession.id)})`)).baseline.findings.length, 21, 'Session preserves the original baseline after a later import');
    fs.writeFileSync(path.join(source, 'index.js'), 'const synthetic = "remediated";');
    assert.equal((await contents.executeJavaScript('window.marx.fs.sourceStatus(window.acceptanceSource, "s1")')).matches, false);
    contents.reload();
    await waitFor(contents, `document.querySelector('[aria-label="Remediation title"]')?.value === 'Synthetic injection remediation'`);
    assert.equal(await contents.executeJavaScript(`document.querySelector('[aria-label="Remediation notes"]').value`), 'Reviewed the synthetic source-to-sink evidence.');
    await contents.executeJavaScript(`window.acceptanceSource = ${JSON.stringify(fs.realpathSync(source))}; window.acceptanceEvents = []; window.marx.onScanEvent(event => window.acceptanceEvents.push(event)); void 0;`);
    await clickText(contents, 'Run verification scan');
    await waitFor(contents, 'window.marx.workbench.bootstrap().then(data => data.jobs.some(job => job.scanId === "s2" && job.status === "Completed"))');
    await waitFor(contents, `document.querySelector('[aria-label="Verification scan"]')?.value === 's2'`);
    await clickText(contents, 'Compare evidence');
    await waitFor(contents, 'Boolean(document.querySelector(".verification-summary"))');
    const verifiedSession = (await contents.executeJavaScript('window.marx.workbench.bootstrap()')).sessions.find(item => item.id === createdSession.id);
    assert.equal(verifiedSession.status, 'unresolved');
    assert.equal(verifiedSession.verification.comparison.verdict, 'inconclusive');
    assert.equal(verifiedSession.verification.absentIds.length, 21);
    assert.equal(verifiedSession.verification.remainingIds.length, 0);
    assert.ok(verifiedSession.verification.comparison.reasons.some(reason => reason.includes('Effective server configuration')));
    win.setSize(1440, 1420);
    await contents.executeJavaScript('document.querySelector("main").scrollTop = 0; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(folder, 'workbench-session.png'), (await contents.capturePage()).toPNG());
    await clickText(contents, 'Export evidence bundle');
    await waitFor(contents, 'document.body.textContent.includes("Evidence exported")');
    const exportedEvidence = JSON.parse(fs.readFileSync(promptFile, 'utf8'));
    assert.equal(exportedEvidence.baseline.findings.length, 21);
    assert.equal(exportedEvidence.verification.findings.length, 0);
    assert.equal(exportedEvidence.session.changeRef, 'feature/synthetic-fix');
    win.setSize(1440, 1180);
    await contents.executeJavaScript('document.querySelector("main").scrollTop = 0; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    win.setSize(960, 640);
    await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await contents.executeJavaScript('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    fs.writeFileSync(path.join(folder, 'session-960x640.png'), (await contents.capturePage()).toPNG());
    await clickText(contents, 'Activity & evidence');
    await waitFor(contents, 'document.querySelectorAll(".activity-job").length >= 2');
    await contents.executeJavaScript('document.querySelector(".activity-job").click()');
    await waitFor(contents, 'document.querySelector(".activity-log")?.textContent.includes("CLI")');
    assert.equal(await contents.executeJavaScript('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.startsWith("Saved evidence (")).click()');
    await waitFor(contents, 'document.querySelectorAll(".cache-row").length >= 2');
    assert.ok((await contents.executeJavaScript('window.marx.workbench.bootstrap()')).jobs.some(job => job.id === completed.id));
    win.setSize(1280, 840);

    const failure = await contents.executeJavaScript(`window.marx.scan.run({ folderPath: window.acceptanceSource, projectName: 'failure', options: { scanners: ['sast'], branch: 'main', sastPreset: '', sastIncremental: false, scaExploitablePath: false, excludes: [], tags: {} } })`);
    await waitFor(contents, `window.acceptanceEvents.some(event => event.kind === 'job-updated' && event.job.id === ${JSON.stringify(failure.id)} && event.job.progress.phase === 'failed')`);
    const failed = await contents.executeJavaScript(`window.acceptanceEvents.find(event => event.kind === 'job-updated' && event.job.id === ${JSON.stringify(failure.id)} && event.job.progress.phase === 'failed').job`);
    assert.ok(failed.error.includes('Synthetic upload rejected (401)'));
    assert.ok(failed.error.includes('submission is unconfirmed'));
    assert.equal(await contents.executeJavaScript('window.marx.bindings.save(window.acceptanceSource, "wrong-project").then(() => false, error => error.message.includes("different project"))'), true);
    assert.equal((await contents.executeJavaScript('window.marx.bindings.get(window.acceptanceSource)')).projectId, 'p1');
    assert.equal((await contents.executeJavaScript('window.marx.fs.readSourceFile(window.acceptanceSource, "index.js", 1, "p1")')).lines[0], 'const synthetic = \"remediated\";');
    assert.equal(await contents.executeJavaScript('window.marx.fs.readSourceFile(window.acceptanceSource, "index.js", 1, "p2").then(() => false, error => error.message.includes("Link this repository"))'), true);
    fs.writeFileSync(config, 'tenant: changed-profile\n');
    assert.equal(await contents.executeJavaScript('window.marx.bindings.get(window.acceptanceSource)'), null);
    assert.equal(await contents.executeJavaScript('window.marx.scan.run({ folderPath: window.acceptanceSource, projectId: "p1", projectName: "synthetic-fixture", options: {} }).then(() => false, error => error.message.includes("mapping"))'), true);
    fs.writeFileSync(config, 'tenant: synthetic-fixture\n');
    const beforeObsolete = fs.readFileSync(receipt, 'utf8').trim().split('\n').length;
    fs.writeFileSync(obsolete, 'unsupported scan-info-format');
    assert.equal(await contents.executeJavaScript('window.marx.settings.testConnection().then(() => false, error => error.message.includes("--scan-info-format"))'), true);
    const beforeBlockedJobs = (await contents.executeJavaScript('window.marx.scan.jobs()')).length;
    assert.equal(await contents.executeJavaScript(`window.marx.scan.run({ folderPath: window.acceptanceSource, projectName: 'blocked-new', options: { scanners: ['sast'], branch: 'main', sastPreset: '', sastIncremental: false, scaExploitablePath: false, excludes: [], tags: {} } }).then(() => false, error => error.message.includes('--scan-info-format'))`), true);
    assert.equal((await contents.executeJavaScript('window.marx.scan.jobs()')).length, beforeBlockedJobs);
    const blockedCalls = fs.readFileSync(receipt, 'utf8').trim().split('\n').slice(beforeObsolete).map(JSON.parse);
    assert.ok(blockedCalls.some(call => call.args.includes('--help')));
    assert.ok(!blockedCalls.some(call => !call.args.includes('--help') && (call.args[0] === 'auth' || (call.args[0] === 'scan' && call.args[1] === 'create'))));
    assert.equal((await contents.executeJavaScript('window.marx.bindings.get(window.acceptanceSource)')).projectId, 'p1');
    fs.rmSync(obsolete);
    contents.reload();
    await waitFor(contents, 'Boolean(document.querySelector(".nav-item"))');
    await contents.executeJavaScript(`Array.from(document.querySelectorAll('.nav-item')).find(button => button.textContent.trim() === 'Scan').click()`);
    await waitFor(contents, 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "source with spaces")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "source with spaces").click()');
    await waitFor(contents, 'document.querySelector("select[aria-label=\\"Checkmarx One project\\"]")?.value === "p1"');
    assert.equal(await contents.executeJavaScript('document.body.textContent.includes("Saved mapping:")'), true);
    const beforeBatchCalls = fs.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse).filter(call => call.args[0] === 'scan' && call.args[1] === 'create' && !call.args.includes('--help')).length;
    await clickText(contents, 'Batch Scan', '.nav-item');
    await waitFor(contents, 'Array.from(document.querySelectorAll(".page-title")).some(element => element.textContent === "Batch scan" && element.getClientRects().length)');
    selectedFolder = fs.realpathSync(workspace);
    await contents.executeJavaScript(`document.querySelector('button[aria-label="Choose a project folder"]').click()`);
    await waitFor(contents, `Boolean(document.querySelector('[aria-label="Project for apps/frontend"]')) && Boolean(document.querySelector('[aria-label="Project for packages/nested/core"]'))`);
    selectedFolder = null;
    const workspacePlan = await contents.executeJavaScript(`window.marx.git.plan(${JSON.stringify(fs.realpathSync(workspace))})`);
    assert.deepEqual(workspacePlan.projects.map(item => item.relativePath), ['apps/frontend', 'packages/nested/core']);
    assert.deepEqual(workspacePlan.projects.find(item => item.name === 'synthetic-web').dependencies, ['synthetic-core']);
    assert.ok(workspacePlan.sharedFiles.includes('package.json'));
    assert.equal(await contents.executeJavaScript('document.body.textContent.includes("2 of 2 projects selected")'), true);
    await setControl(contents, 'Project for apps/frontend', 'p1');
    await setControl(contents, 'Project for packages/nested/core', 'p1');
    await contents.executeJavaScript(`(() => {
      for (const relativePath of ['apps/frontend', 'packages/nested/core']) {
        const card = document.querySelector('[aria-label="Project for ' + relativePath + '"]').closest('.card');
        card.querySelector('details').open = true;
        card.querySelector('details .check input').click();
      }
    })()`);
    await waitFor(contents, 'document.querySelectorAll(".card details .scanner-grid").length === 2');
    await contents.executeJavaScript(`(() => {
      for (const [relativePath, disabledScanner] of [['apps/frontend', 'SCA'], ['packages/nested/core', 'SAST']]) {
        const card = document.querySelector('[aria-label="Project for ' + relativePath + '"]').closest('.card');
        Array.from(card.querySelectorAll('.scanner-card')).find(element => element.querySelector('.head').textContent.trim().startsWith(disabledScanner)).querySelector('input').click();
      }
    })()`);
    await waitFor(contents, 'document.querySelectorAll(".card details .scanner-card.selected").length === 2');
    await contents.executeJavaScript(`(() => {
      const web = document.querySelector('[aria-label="Project for apps/frontend"]').closest('.card');
      const core = document.querySelector('[aria-label="Project for packages/nested/core"]').closest('.card');
      const set = (element, value) => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); };
      set(web.querySelector('input[placeholder="Checkmarx Default"]'), 'OWASP Top 10 2021');
      set(web.querySelector('textarea'), 'web-fixtures');
      set(web.querySelector('input[placeholder="team:frontend, tier:critical"]'), 'package:web');
      set(core.querySelector('textarea'), 'core-fixtures');
      set(core.querySelector('input[placeholder="team:frontend, tier:critical"]'), 'package:core');
      Array.from(core.querySelectorAll('.toggle')).find(element => element.textContent.includes('Exploitable Path')).querySelector('input').click();
      const parallel = Array.from(document.querySelectorAll('label.field')).find(element => element.textContent.trim().startsWith('Parallel scans')).querySelector('input');
      set(parallel, '1');
    })()`);
    assert.equal(await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Scan 2 projects").disabled'), false);
    assert.equal(fs.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse).filter(call => call.args[0] === 'scan' && call.args[1] === 'create' && !call.args.includes('--help')).length, beforeBatchCalls, 'Reviewing a workspace never submits scans');
    win.setSize(1440, 1100);
    await contents.executeJavaScript('document.querySelector("main").scrollTop = 0; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(folder, 'workspace-plan.png'), (await contents.capturePage()).toPNG());
    await clickText(contents, 'Scan 2 projects');
    await waitFor(contents, 'window.marx.workbench.bootstrap().then(data => data.jobs.filter(job => job.batchId && job.finishedAt && job.progress.phase === "completed" && job.status === "Completed").length === 2)');
    await waitFor(contents, 'document.querySelectorAll(".batch-table tbody tr").length === 2');
    const batchJobs = (await contents.executeJavaScript('window.marx.workbench.bootstrap()')).jobs.filter(job => job.batchId);
    assert.equal(batchJobs.length, 2);
    assert.equal(new Set(batchJobs.map(job => job.batchId)).size, 1);
    assert.equal(new Set(batchJobs.map(job => job.id)).size, 2);
    assert.ok(batchJobs.every(job => job.projectId === 'p1' && job.finishedAt && job.status === 'Completed'));
    const webJob = batchJobs.find(job => job.folderPath === fs.realpathSync(workspaceWeb));
    const coreJob = batchJobs.find(job => job.folderPath === fs.realpathSync(workspaceCore));
    assert.deepEqual(webJob.options.scanners, ['sast']);
    assert.equal(webJob.options.sastPreset, 'OWASP Top 10 2021');
    assert.equal(webJob.options.sastIncremental, false);
    assert.deepEqual(webJob.options.excludes, ['web-fixtures']);
    assert.deepEqual(webJob.options.tags, { package: 'web' });
    assert.deepEqual(coreJob.options.scanners, ['sca']);
    assert.equal(coreJob.options.scaExploitablePath, true);
    assert.deepEqual(coreJob.options.excludes, ['core-fixtures']);
    assert.deepEqual(coreJob.options.tags, { package: 'core' });
    const afterBatchCalls = fs.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse).filter(call => call.args[0] === 'scan' && call.args[1] === 'create' && !call.args.includes('--help'));
    assert.equal(afterBatchCalls.length, beforeBatchCalls + 2);
    for (const [projectFolder, scanners] of [[workspaceWeb, 'sast'], [workspaceCore, 'sca']]) {
      const call = afterBatchCalls.find(item => item.args.includes('--file-source=' + fs.realpathSync(projectFolder)));
      assert.ok(call.args.includes('--project-name=synthetic-fixture'));
      assert.ok(call.args.includes('--scan-types=' + scanners));
      assert.equal((await contents.executeJavaScript(`window.marx.bindings.get(${JSON.stringify(fs.realpathSync(projectFolder))})`)).projectId, 'p1');
    }
    contents.reload();
    await waitFor(contents, 'document.querySelectorAll(".batch-table tbody tr").length === 2');
    const restoredBatchJobs = (await contents.executeJavaScript('window.marx.workbench.bootstrap()')).jobs.filter(job => job.batchId === webJob.batchId);
    assert.equal(restoredBatchJobs.length, 2);
    for (const original of batchJobs) assert.deepEqual(restoredBatchJobs.find(job => job.id === original.id).options, original.options);
    win.setSize(960, 640);
    await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await contents.executeJavaScript('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    fs.writeFileSync(path.join(folder, 'batch-restored-960x640.png'), (await contents.capturePage()).toPNG());
    const largePage = await contents.executeJavaScript('window.marx.results.get("large-paging")');
    assert.equal(largePage.findings.length, 5051);
    contents.reload();
    await waitFor(contents, 'document.querySelectorAll(".batch-table tbody tr").length === 2');
    await clickText(contents, 'Results', '.nav-item');
    await waitFor(contents, `Boolean(document.querySelector('[aria-label="Scan"] option[value="large-paging"]'))`);
    await setControl(contents, 'Scan', 'large-paging');
    await waitFor(contents, 'document.querySelectorAll(".finding-link").length === 100');
    await setControl(contents, 'Search findings', 'Synthetic injection');
    await clickText(contents, 'Next', '.investigation-list .pagination button');
    await waitFor(contents, 'document.querySelector(".finding-link")?.textContent === "Synthetic injection 101"');
    await clickText(contents, 'Next', '.investigation-list .pagination button');
    await waitFor(contents, 'document.querySelector(".finding-link")?.textContent === "Synthetic injection 201"');
    await contents.executeJavaScript('document.querySelector(".finding-link").click()');
    await waitFor(contents, 'document.querySelector(".finding-heading")?.textContent === "Synthetic injection 201"');
    const largeWorkspaceKey = `results:${(await contents.executeJavaScript('window.marx.workbench.bootstrap()')).connectionId}:large-paging`;
    await waitFor(contents, `window.marx.workbench.workspace(${JSON.stringify(largeWorkspaceKey)}).then(state => state?.pageIndex === 2 && state?.selectedFindingId === 'finding-201' && state?.search === 'Synthetic injection')`);
    contents.reload();
    await waitFor(contents, 'document.querySelector(".finding-heading")?.textContent === "Synthetic injection 201"');
    assert.equal(await contents.executeJavaScript('document.querySelector(".finding-link")?.textContent'), 'Synthetic injection 201');
    assert.equal(await contents.executeJavaScript('document.querySelectorAll(".finding-link").length'), 100);
    await clickText(contents, 'All findings');
    await clickText(contents, 'Group by fix');
    await waitFor(contents, 'document.querySelectorAll(".remediation-group").length === 100');
    assert.ok(await contents.executeJavaScript(`document.querySelector('[aria-label="Fix group pages"]').textContent.includes('5,051 fix groups')`));
    const firstGroupTitle = await contents.executeJavaScript('document.querySelector(".remediation-group strong").textContent');
    await clickText(contents, 'Next groups');
    await waitFor(contents, `document.querySelector('.remediation-group strong').textContent !== ${JSON.stringify(firstGroupTitle)}`);
    assert.equal(await contents.executeJavaScript('document.querySelectorAll(".remediation-group").length'), 100);
    await setControl(contents, 'Search findings', 'Synthetic injection 505');
    await waitFor(contents, 'document.querySelectorAll(".remediation-group").length === 3');
    assert.equal(await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Previous groups").disabled'), true);
    console.log(JSON.stringify({ result: 'passed', evidence: '%TEMP%/marx-cli-acceptance-<generated>', checks: ['opaque native window and application background without full-window blur', 'native CLI configuration without Marx API key', 'CLI capability preflight and obsolete CLI blocked before authentication/upload', 'explicit project mapping, configuration invalidation, protected source access and reload restoration', 'explicit baseline, branch opt-in and reset', 'CLI connection test', 'settings at 1280 and 960 pixels', 'demo remains available with CLI authentication', 'remediation severity selection, preview, copy and Markdown save', 'dropdown inset and remediation dialog at desktop and narrow widths', 'Escape and focus return', 'multi-batch navigation, copy and complete Markdown export', 'filtered and individual finding scope, generic assistant', 'empty/oversized copy rejection, canceled and duplicate saves', 'GUI folder selection and scan button', 'sustained CLI output without application-shell rerenders, focus loss or scroll jumps', 'bounded scrolling log, live timer and navigation during scanning', 'subprocess scan and progress', 'summary and findings rendered', 'single initial submission', 'CLI failure and uncertain-outcome message', 'persistent filters, selected finding and resize keyboard controls', '960 by 640 layouts and reduced motion', 'fix grouping rationale', 'tracked remediation creation, notes and renderer reload restoration', 'pinned baseline survives a refreshed snapshot', 'source drift detected', 'explicit verification scan and inconclusive coverage', 'complete evidence export', 'durable activity, diagnostics and saved evidence', 'nested workspace discovery through the GUI, exact project mappings and custom per-project scanners', 'review before two explicit batch submissions, common batch identity and durable options after reload', '5051 complete findings with 100-row and 100-group DOM bounds, filter and page-three selection restored after reload'] }, null, 2));
  } catch (error) {
    console.error(error);
    try { console.error(await contents.executeJavaScript('JSON.stringify(window.scanRenderCounts)')); console.error((await contents.executeJavaScript('document.body.innerText')).slice(-6000)); } catch {}
    process.exitCode = 1;
    console.error(`Evidence retained at ${folder}`);
  } finally {
    win.destroy();
    app.exit(process.exitCode || 0);
  }
});
