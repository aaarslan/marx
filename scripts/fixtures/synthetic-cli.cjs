const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const value = (name) => args.find((arg) => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
fs.appendFileSync(path.join(process.env.MARX_FIXTURE_ROOT, "receipt"), JSON.stringify({ args, cwd: process.cwd() }) + '\n');
const project = { ID: 'p1', Name: 'synthetic-fixture', MainBranch: 'main' };
const scan = { ID: 's1', ProjectID: 'p1', ProjectName: 'synthetic-fixture', Branch: 'master', Status: 'Completed', CreatedAt: '2026-10-30T12:00:00Z' };
if (args.includes('--help')) {
  const flags = ['debug', 'retry', 'config-file-path', 'format', 'filter', 'project-id', 'file-source', 'project-name', 'branch', 'scan-types', 'async', 'scan-info-format', 'skip-default-filter', 'file-filter', 'file-filter-ext', 'exclude-git-folder', 'sast-incremental', 'sast-preset-name', 'sca-exploitable-path', 'base-branch', 'tags', 'scan-id', 'report-format', 'output-name', 'output-path'];
  console.log('Usage: cx ' + args.slice(0, -1).join(' ') + '\nFlags:\n' + flags.filter(flag => !fs.existsSync(path.join(process.env.MARX_FIXTURE_ROOT, "obsolete")) || flag !== 'scan-info-format').map(flag => '  --' + flag + ' string   Synthetic capability').join('\n'));
}
else if (args[0] === 'version') console.log('2.3.69-synthetic');
else if (args[0] === 'auth') console.log('Authenticated');
else if (args[0] === 'project' && args[1] === 'show') console.log(JSON.stringify(project));
else if (args[0] === 'project') console.log(JSON.stringify([project]));
else if (args[0] === 'scan' && args[1] === 'create') {
  if (!fs.existsSync(path.join(value('file-source'), 'index.js'))) process.exit(2);
  if (value('project-name') === 'failure') { console.error('Synthetic upload rejected (401)'); process.exit(1); }
  const number = Number(fs.existsSync(path.join(process.env.MARX_FIXTURE_ROOT, "counter")) ? fs.readFileSync(path.join(process.env.MARX_FIXTURE_ROOT, "counter"), 'utf8') : 0) + 1;
  fs.writeFileSync(path.join(process.env.MARX_FIXTURE_ROOT, "counter"), String(number));
  scan.ID = 's' + number;
  if (number > 1) scan.CreatedAt = '2026-10-31T12:00:00Z';
  console.error('CLI preparing and uploading synthetic source');
  if (fs.existsSync(path.join(process.env.MARX_FIXTURE_ROOT, "holdSubmission"))) {
    let count = 0;
    const timer = setInterval(() => {
      if (++count > 200) { console.error('Synthetic submission hold timed out'); process.exit(1); }
      console.error('Synthetic live progress ' + count);
      if (!fs.existsSync(path.join(process.env.MARX_FIXTURE_ROOT, "holdSubmission"))) { clearInterval(timer); console.log(JSON.stringify(scan)); }
    }, 50);
  } else console.log(JSON.stringify(scan));
}
else if (args[0] === 'scan' && args[1] === 'list') console.log(JSON.stringify([...(Number(fs.existsSync(path.join(process.env.MARX_FIXTURE_ROOT, "counter")) ? fs.readFileSync(path.join(process.env.MARX_FIXTURE_ROOT, "counter"), 'utf8') : 0) > 1 ? [{ ...scan, ID: 's2', CreatedAt: '2026-10-31T12:00:00Z' }] : []), scan, { ...scan, ID: 'baseline', CreatedAt: '2026-10-29T12:00:00Z' }, { ...scan, ID: 'cross-branch', Branch: 'feature', CreatedAt: '2026-10-28T12:00:00Z' }, { ...scan, ID: 'wrong-project', ProjectID: 'p2', CreatedAt: '2026-10-27T12:00:00Z' }]));
else if (args[0] === 'scan' && args[1] === 'show') console.log(JSON.stringify(value('scan-id') === 's1' ? scan : value('scan-id') === 's2' ? { ...scan, ID: 's2', CreatedAt: '2026-10-31T12:00:00Z' } : { ...scan, ID: value('scan-id'), Branch: value('scan-id') === 'cross-branch' ? 'feature' : scan.Branch, CreatedAt: '2026-10-28T12:00:00Z' }));
else if (args[0] === 'scan' && args[1] === 'cancel') console.log('Canceled');
else if (args[0] === 'results') {
  const count = value('scan-id') === 'large-paging' ? 5051 : value('scan-id') === 's2' ? 0 : value('scan-id') === 's1' && fs.existsSync(path.join(process.env.MARX_FIXTURE_ROOT, "changedEvidence")) ? 20 : 21;
  const report = value('report-format') === 'summaryJSON'
    ? { CriticalIssues: 0, HighIssues: count, MediumIssues: 0, LowIssues: 0, InfoIssues: 0 }
    : { scanID: value('scan-id'), totalCount: count, results: Array.from({ length: count }, (_, index) => ({ id: 'finding-' + (index + 1), similarityId: 'stable-' + (index + 1), type: 'sast', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW', data: { queryName: index ? 'Synthetic injection ' + (index + 1) : 'Synthetic injection', nodes: [{ fileName: 'index.js', line: 1 }] } })) };
  fs.writeFileSync(path.join(value('output-path'), value('report-format') === 'sarif' ? 'report.sarif' : 'report.json'), JSON.stringify(value('report-format') === 'sarif' ? { version: '2.1.0', runs: [{ tool: { driver: { name: 'Synthetic CLI' } }, results: [] }] } : report));
  console.log('Report created');
}
else process.exit(3);