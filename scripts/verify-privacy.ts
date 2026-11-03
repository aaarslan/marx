import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { version } from '../package.json';

const root = homedir();
const homes = [root, root.replaceAll('\\', '/'), root.replaceAll('\\', '\\\\')].filter(Boolean);
const all = process.argv.includes('--all');
const files = execFileSync('git', all ? ['ls-files', '-z'] : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const signatures = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub credential', /(?:gh[pousr]_|github_pat_)[A-Za-z0-9_.-]{30,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['personal email', /[a-zA-Z0-9._%+-]+@(?:gmail|hotmail|outlook|icloud)\.com/i],
] as const;
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
function containsHomePath(data: Buffer, value: string, encoding: 'utf8' | 'utf16le') {
  const marker = Buffer.from(value, encoding);
  for (let offset = data.indexOf(marker); offset !== -1; offset = data.indexOf(marker, offset + 1)) {
    const end = offset + marker.length;
    if (end === data.length) return true;
    const next = encoding === 'utf16le' && end + 1 < data.length ? data.readUInt16LE(end) : data[end];
    if (next <= 32 || '/\\\"\'`<>()[]{},;:=!?'.includes(String.fromCharCode(next))) return true;
  }
  return false;
}
function inspect(file: string, data = readFileSync(file)) {
  for (const value of homes)
    if (containsHomePath(data, value, 'utf8') || containsHomePath(data, value, 'utf16le'))
      fail(`Personal home-directory path found in ${file}`);
  for (const encoding of ['utf8', 'utf16le'] as const) {
    const content = data.toString(encoding);
    for (const [name, pattern] of signatures)
      if (pattern.test(content)) fail(`${name} signature found in ${file}; matched content withheld`);
  }
}
for (const file of files) {
  inspect(file, execFileSync('git', ['show', `:${file}`], { maxBuffer: 128 * 1024 * 1024 }));
  if (all && existsSync(file)) inspect(file);
}
for (const file of ['dist/Marx.app/Contents/MacOS/Marx', 'dist/Marx.exe', `dist/Marx-${version}-win-x64-setup.exe`])
  if (existsSync(file)) inspect(file);
if (process.argv.includes('--history')) {
  const commits = execFileSync('git', ['log', 'HEAD', '--format=%H%x00%ae%x00%ce'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const privateIdentities = commits.filter((line) => line.split('\0').slice(1).some((email) => !email.endsWith('@users.noreply.github.com'))).map((line) => line.split('\0')[0].slice(0, 12));
  if (privateIdentities.length)
    fail(`Commit identities require review in ${privateIdentities.length} commits: ${privateIdentities.join(', ')}. Email values withheld. Publishing a history rewrite requires explicit coordination.`);
}
console.log(`${all ? 'Tracked index and available working-tree' : 'Staged'} files and available release executables passed path and credential/email signature checks${process.argv.includes('--history') ? '; commit identities use GitHub noreply addresses' : '; history was not checked'}.`);
