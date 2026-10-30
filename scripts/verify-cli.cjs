const { app, BrowserWindow } = require('electron');
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
if (args[0] === 'version') console.log('2.3.69-synthetic');
else if (args[0] === 'auth') console.log('Authenticated');
else if (args[0] === 'project') console.log(JSON.stringify([project]));
else if (args[0] === 'scan' && args[1] === 'create') {
  if (!fs.existsSync(path.join(value('file-source'), 'index.js'))) process.exit(2);
  if (value('project-name') === 'failure') { console.error('Synthetic upload rejected (401)'); process.exit(1); }
  console.error('CLI preparing and uploading synthetic source');
  console.log(JSON.stringify(scan));
}
else if (args[0] === 'scan' && args[1] === 'list') console.log(JSON.stringify([scan]));
else if (args[0] === 'scan' && args[1] === 'show') console.log(JSON.stringify(scan));
else if (args[0] === 'scan' && args[1] === 'cancel') console.log('Canceled');
else if (args[0] === 'results') {
  const report = value('report-format') === 'summaryJSON'
    ? { CriticalIssues: 0, HighIssues: 1, MediumIssues: 0, LowIssues: 0, InfoIssues: 0 }
    : { scanID: 's1', totalCount: 1, results: [{ id: 'finding-1', type: 'sast', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW', data: { queryName: 'Synthetic injection', nodes: [{ fileName: 'index.js', line: 1 }] } }] };
  fs.writeFileSync(path.join(value('output-path'), 'report.json'), JSON.stringify(report));
  console.log('Report created');
}
else process.exit(3);
`, { mode: 0o700 });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ cliPath: executable, cliAuthMode: 'cli', recentFolders: [fs.realpathSync(source)] }));
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
    await waitFor(contents, 'document.body.textContent.includes("authenticated and project access verified")');
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
    await contents.executeJavaScript(`Array.from(document.querySelectorAll('.nav-item')).find(button => button.textContent.trim() === 'Scan').click()`);
    await waitFor(contents, 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "source with spaces")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "source with spaces").click()');
    await waitFor(contents, 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.includes("Run scan") && !button.disabled)');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Run scan") && !button.disabled).click()');
    await waitFor(contents, 'window.acceptanceEvents.some(event => event.kind === "job-updated" && event.job.progress.phase === "completed")');
    const events = await contents.executeJavaScript('window.acceptanceEvents');
    const completed = events.find((event) => event.kind === 'job-updated' && event.job.progress.phase === 'completed').job;
    assert.equal(completed.scanId, 's1');
    assert.equal(completed.summary.HIGH, 1);
    assert.ok(events.some((event) => event.kind === 'log' && event.line.includes('CLI preparing')));
    await waitFor(contents, 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "View results")');
    await contents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "View results").click()');
    await waitFor(contents, 'document.body.textContent.includes("Synthetic injection")');
    assert.equal((await contents.executeJavaScript('window.marx.results.get("s1")')).findings[0].title, 'Synthetic injection');
    const calls = fs.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter((call) => call.args[0] === 'scan' && call.args[1] === 'create').length, 1);
    const scanCall = calls.find((call) => call.args[0] === 'scan' && call.args[1] === 'create');
    assert.ok(scanCall.args.includes(`--file-source=${fs.realpathSync(source)}`));
    assert.ok(scanCall.args.includes('--scan-types=sast,sca'));
    assert.ok(scanCall.args.includes('--sast-incremental=true'));
    assert.ok(scanCall.args.includes('--exclude-git-folder'));
    const failure = await contents.executeJavaScript(`window.marx.scan.run({ folderPath: window.acceptanceSource, projectName: 'failure', options: { scanners: ['sast'], branch: 'main', sastPreset: '', sastIncremental: false, scaExploitablePath: false, excludes: [], tags: {} } })`);
    await waitFor(contents, `window.acceptanceEvents.some(event => event.kind === 'job-updated' && event.job.id === ${JSON.stringify(failure.id)} && event.job.progress.phase === 'failed')`);
    const failed = await contents.executeJavaScript(`window.acceptanceEvents.find(event => event.kind === 'job-updated' && event.job.id === ${JSON.stringify(failure.id)} && event.job.progress.phase === 'failed').job`);
    assert.ok(failed.error.includes('Synthetic upload rejected (401)'));
    assert.ok(failed.error.includes('submission is unconfirmed'));
    console.log(JSON.stringify({ result: 'passed', evidence: folder, checks: ['native CLI configuration without Marx API key', 'CLI connection test', 'settings at 1280 and 960 pixels', 'demo remains available with CLI authentication', 'GUI folder selection and scan button', 'subprocess scan and progress', 'summary and findings rendered', 'single submission', 'CLI failure and uncertain-outcome message'] }, null, 2));
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
