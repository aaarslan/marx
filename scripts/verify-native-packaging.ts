import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const executable=readFileSync('dist/Marx.exe');
assert.equal(executable.toString('ascii',0,2),'MZ');
const pe=executable.readUInt32LE(0x3c);
assert.equal(executable.toString('ascii',pe,pe+4),'PE\0\0');
assert.equal(executable.readUInt16LE(pe+4),0x8664,'Application must target Windows x64');
assert.equal(executable.readUInt16LE(pe+24),0x20b,'Application must be PE32+');
assert.equal(existsSync('dist/marx-core.exe'),false,'A stale workflow sidecar remains in dist');
assert.equal(executable.includes(Buffer.from('/$bunfs/')),false,'A Bun runtime was embedded');
assert.equal(executable.includes(Buffer.from('MARX_FIXTURE_ROOT')),false,'The test CLI fixture was packaged');
const nsis=readFileSync('build/windows.nsi','utf8');
assert.deepEqual([...nsis.matchAll(/^\s*File\s+"([^"]+)"/gm)].map(match=>match[1]),['..\\dist\\Marx.exe']);
const assets='native/frontend/dist/assets';
for(const view of ['ResultsView','BatchView','WorkbenchView','SettingsView','RemediationDialog']) {
 const file=readdirSync(assets).find(file=>file.startsWith(view+'-')&&file.endsWith('.js'));
 assert.ok(file,`${view} chunk is missing`);assert.ok(executable.includes(readFileSync(join(assets,file))),`${view} was not embedded`);
}
const go=process.env.GO_EXECUTABLE||Bun.which('go')||join(process.env.LOCALAPPDATA!,'MarxBuildTools/go/bin/go.exe');
const metadata=execFileSync(go,['version','-m','dist/Marx.exe'],{encoding:'utf8'});
assert.match(metadata,/GOARCH=amd64/);assert.match(metadata,/modernc.org\/sqlite\s+v1\.61\.1/);
assert.match(metadata,/-trimpath=true/);
assert.doesNotMatch(metadata,/git\.sr\.ht\/\~jackmordaunt\/go-toast/,'Desktop toast support was linked into the application');
console.log('Windows x64 PE, Go SQLite engine, embedded lazy views, single-executable installer payload, and absence of Bun sidecar verified.');
