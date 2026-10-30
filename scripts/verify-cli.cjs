const { app, BrowserWindow, clipboard, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform === 'win32') throw new Error('This synthetic CLI executable harness currently requires macOS or Linux.');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-cli-acceptance-'));
const profile = path.join(folder, 'profile');
const source = path.join(folder, 'source with spaces');
const executable = path.join(folder, 'cx');
const receipt = path.join(folder, 'calls.jsonl');
const obsolete = path.join(folder, 'obsolete');
const config = path.join(folder, 'cli-config.yaml');
fs.writeFileSync(config, 'tenant: synthetic-fixture\n');
fs.mkdirSync(profile);
fs.mkdirSync(source);
fs.writeFileSync(path.join(source, 'package.json'), '{"name":"synthetic-fixture"}');
fs.writeFileSync(path.join(source, 'index.js'), 'const synthetic = true;');
const node = require('node:child_process').execFileSync('which', ['node'], { encoding: 'utf8' }).trim();
fs.writeFileSync(executable, `#!${node}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const value = (name) => args.find((arg) => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
fs.appendFileSync(${JSON.stringify(receipt)}, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
const project = { ID: 'p1', Name: 'synthetic-fixture', MainBranch: 'main' };
const scan = { ID: 's1', ProjectID: 'p1', ProjectName: 'synthetic-fixture', Branch: 'main', Status: 'Completed', CreatedAt: '2026-10-30T12:00:00Z' };
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
  console.error('CLI preparing and uploading synthetic source');
  console.log(JSON.stringify(scan));
}
else if (args[0] === 'scan' && args[1] === 'list') console.log(JSON.stringify([scan, { ...scan, ID: 'baseline', CreatedAt: '2026-10-29T12:00:00Z' }, { ...scan, ID: 'cross-branch', Branch: 'feature', CreatedAt: '2026-10-28T12:00:00Z' }, { ...scan, ID: 'wrong-project', ProjectID: 'p2', CreatedAt: '2026-10-27T12:00:00Z' }]));
else if (args[0] === 'scan' && args[1] === 'show') console.log(JSON.stringify(value('scan-id') === 's1' ? scan : { ...scan, ID: value('scan-id'), Branch: value('scan-id') === 'cross-branch' ? 'feature' : 'main', CreatedAt: '2026-10-28T12:00:00Z' }));
else if (args[0] === 'scan' && args[1] === 'cancel') console.log('Canceled');
else if (args[0] === 'results') {
  const report = value('report-format') === 'summaryJSON'
    ? { CriticalIssues: 0, HighIssues: 21, MediumIssues: 0, LowIssues: 0, InfoIssues: 0 }
    : { scanID: value('scan-id'), totalCount: 21, results: Array.from({ length: 21 }, (_, index) => ({ id: 'finding-' + (index + 1), type: 'sast', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW', data: { queryName: index ? 'Synthetic injection ' + (index + 1) : 'Synthetic injection', nodes: [{ fileName: 'index.js', line: 1 }] } })) };
  fs.writeFileSync(path.join(value('output-path'), 'report.json'), JSON.stringify(report));
  console.log('Report created');
}
else process.exit(3);
`, { mode: 0o700 });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ cliPath: executable, cliConfigPath: config, cliAuthMode: 'cli', recentFolders: [fs.realpathSync(source)] }));
let copiedPrompt = '';
const promptFile = path.join(folder, 'remediation.md');
clipboard.writeText = (text) => { copiedPrompt = text; };
let pendingSave = null;
dialog.showSaveDialog = async () => pendingSave ? new Promise((resolve) => { pendingSave.resolve = resolve; }) : ({ canceled: false, filePath: promptFile });
app.setPath('userData', profile);
app.on('browser-window-created', (_event, win) => { win.on('show', () => win.hide()); });
require(process.env.MARX_ACCEPTANCE_BUNDLE ? path.join(process.env.MARX_ACCEPTANCE_BUNDLE, 'out/main/index.js') : '../out/main/index.js');

async function waitFor(contents, expression) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await contents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${expression}`);
}

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const contents = win.webContents;
  try {
    contents.setBackgroundThrottling(false);
    await waitFor(contents, 'Boolean(document.querySelector(".nav-item"))');
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
    assert.equal(await contents.executeJavaScript('window.marx.remediation.copy("€".repeat(2800000)).then(() => false, error => error.message.includes("8 MiB"))'), true);
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
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Run scan") && !button.disabled).click()');
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
    await waitFor(contents, 'document.body.textContent.includes("Recurrent")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("label")).find(label => label.textContent.includes("Show other branches")).querySelector("input").click()');
    await waitFor(contents, 'document.querySelector("select[aria-label=\\"Baseline scan\\"]").value === ""');
    for (const width of [1280, 960]) {
      win.setSize(width, 840);
      await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      assert.equal(await contents.executeJavaScript('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
      fs.writeFileSync(path.join(folder, `baseline-${width}.png`), (await contents.capturePage()).toPNG());
    }
    const failure = await contents.executeJavaScript(`window.marx.scan.run({ folderPath: window.acceptanceSource, projectName: 'failure', options: { scanners: ['sast'], branch: 'main', sastPreset: '', sastIncremental: false, scaExploitablePath: false, excludes: [], tags: {} } })`);
    await waitFor(contents, `window.acceptanceEvents.some(event => event.kind === 'job-updated' && event.job.id === ${JSON.stringify(failure.id)} && event.job.progress.phase === 'failed')`);
    const failed = await contents.executeJavaScript(`window.acceptanceEvents.find(event => event.kind === 'job-updated' && event.job.id === ${JSON.stringify(failure.id)} && event.job.progress.phase === 'failed').job`);
    assert.ok(failed.error.includes('Synthetic upload rejected (401)'));
    assert.ok(failed.error.includes('submission is unconfirmed'));
    assert.equal(await contents.executeJavaScript('window.marx.bindings.save(window.acceptanceSource, "wrong-project").then(() => false, error => error.message.includes("different project"))'), true);
    assert.equal((await contents.executeJavaScript('window.marx.bindings.get(window.acceptanceSource)')).projectId, 'p1');
    assert.equal((await contents.executeJavaScript('window.marx.fs.readSourceFile(window.acceptanceSource, "index.js", 1, "p1")')).lines[0], 'const synthetic = true;');
    assert.equal(await contents.executeJavaScript('window.marx.fs.readSourceFile(window.acceptanceSource, "index.js", 1, "p2").then(() => false, error => error.message.includes("Link this repository"))'), true);
    fs.writeFileSync(config, 'tenant: changed-profile\n');
    assert.equal(await contents.executeJavaScript('window.marx.bindings.get(window.acceptanceSource)'), null);
    assert.equal(await contents.executeJavaScript('window.marx.scan.run({ folderPath: window.acceptanceSource, projectId: "p1", projectName: "synthetic-fixture", options: {} }).then(() => false, error => error.message.includes("mapping"))'), true);
    fs.writeFileSync(config, 'tenant: synthetic-fixture\n');
    const beforeObsolete = fs.readFileSync(receipt, 'utf8').trim().split('\n').length;
    fs.writeFileSync(obsolete, 'unsupported scan-info-format');
    assert.equal(await contents.executeJavaScript('window.marx.settings.testConnection().then(() => false, error => error.message.includes("--scan-info-format"))'), true);
    const blocked = await contents.executeJavaScript(`window.marx.scan.run({ folderPath: window.acceptanceSource, projectName: 'blocked-new', options: { scanners: ['sast'], branch: 'main', sastPreset: '', sastIncremental: false, scaExploitablePath: false, excludes: [], tags: {} } })`);
    await waitFor(contents, `window.acceptanceEvents.some(event => event.kind === 'job-updated' && event.job.id === ${JSON.stringify(blocked.id)} && event.job.error?.includes('No upload was started'))`);
    const blockedCalls = fs.readFileSync(receipt, 'utf8').trim().split('\n').slice(beforeObsolete).map(JSON.parse);
    assert.ok(blockedCalls.some(call => call.args.includes('--help')));
    assert.ok(!blockedCalls.some(call => !call.args.includes('--help') && (call.args[0] === 'auth' || (call.args[0] === 'scan' && call.args[1] === 'create'))));
    assert.equal((await contents.executeJavaScript('window.marx.bindings.get(window.acceptanceSource)')).projectId, 'p1');
    fs.rmSync(obsolete);
    contents.reload();
    await waitFor(contents, 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "source with spaces")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "source with spaces").click()');
    await waitFor(contents, 'document.querySelector("select[aria-label=\\"Checkmarx One project\\"]")?.value === "p1"');
    assert.equal(await contents.executeJavaScript('document.body.textContent.includes("Saved mapping:")'), true);
    console.log(JSON.stringify({ result: 'passed', evidence: folder, checks: ['native CLI configuration without Marx API key', 'CLI capability preflight and obsolete CLI blocked before authentication/upload', 'explicit project mapping, configuration invalidation, protected source access and reload restoration', 'explicit baseline, branch opt-in and reset', 'CLI connection test', 'settings at 1280 and 960 pixels', 'demo remains available with CLI authentication', 'remediation severity selection, preview, copy and Markdown save', 'dropdown inset and remediation dialog at desktop and narrow widths', 'Escape and focus return', 'multi-batch navigation, copy and complete Markdown export', 'filtered and individual finding scope, generic assistant', 'empty/oversized copy rejection, canceled and duplicate saves', 'GUI folder selection and scan button', 'subprocess scan and progress', 'summary and findings rendered', 'single submission', 'CLI failure and uncertain-outcome message'] }, null, 2));
  } catch (error) {
    console.error(error);
    try { console.error((await contents.executeJavaScript('document.body.innerText')).slice(-6000)); } catch {}
    process.exitCode = 1;
    console.error(`Evidence retained at ${folder}`);
  } finally {
    win.destroy();
    app.exit(process.exitCode || 0);
  }
});
