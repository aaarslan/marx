import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const root = homedir();
const homes = [root, root.replaceAll('\\', '/'), root.replaceAll('\\', '\\\\')].filter(Boolean);
const all = process.argv.includes('--all');
const files = execFileSync('git', all ? ['ls-files', '-z'] : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const signatures = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub credential', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['personal email', /[a-zA-Z0-9._%+-]+@(?:gmail|hotmail|outlook|icloud)\.com/i],
] as const;
function inspect(file: string, data = readFileSync(file)) {
  for (const value of homes)
    if (data.includes(Buffer.from(value)) || data.includes(Buffer.from(value, 'utf16le')))
      throw new Error(`Personal home-directory path found in ${file}`);
  for (const encoding of ['utf8', 'utf16le'] as const) {
    const content = data.toString(encoding);
    for (const [name, pattern] of signatures)
      if (pattern.test(content)) throw new Error(`${name} signature found in ${file}; matched content withheld`);
  }
}
for (const file of files) {
  if (all) { if (existsSync(file)) inspect(file); }
  else inspect(file, execFileSync('git', ['show', `:${file}`], { maxBuffer: 128 * 1024 * 1024 }));
}
for (const file of ['dist/Marx.app/Contents/MacOS/Marx', 'dist/Marx.exe', 'dist/Marx-0.9.0-win-x64-setup.exe'])
  if (existsSync(file)) inspect(file);
if (process.argv.includes('--history')) {
  const commits = execFileSync('git', ['log', 'HEAD', '--format=%H%x00%ae%x00%ce'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const privateIdentities = commits.filter((line) => line.split('\0').slice(1).some((email) => !email.endsWith('@users.noreply.github.com'))).map((line) => line.split('\0')[0].slice(0, 12));
  if (privateIdentities.length)
    throw new Error(`Commit identities require review in ${privateIdentities.length} commits: ${privateIdentities.join(', ')}. Email values withheld. Publishing a history rewrite requires explicit coordination.`);
}
console.log(`${all ? 'Tracked' : 'Staged'} files and available release executables passed path and credential/email signature checks${process.argv.includes('--history') ? '; commit identities use GitHub noreply addresses' : '; history was not checked'}.`);
