import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const mac=process.platform==='darwin';
const executablePath=mac?'dist/Marx.app/Contents/MacOS/Marx':'dist/Marx.exe';
const executable=readFileSync(executablePath);
if(mac){
 assert.equal(executable.readUInt32LE(0),0xfeedfacf,'Application must be a native Mach-O executable');
 const arch=process.arch==='arm64'?0x100000c:0x1000007;
 assert.equal(executable.readUInt32LE(4),arch,'Application architecture must match this Mac');
 execFileSync('plutil',['-lint','dist/Marx.app/Contents/Info.plist']);
 execFileSync('codesign',['--verify','--deep','--strict','dist/Marx.app']);
 assert.ok(existsSync('dist/Marx.app/Contents/Resources/icon.icns'));
}else{
assert.equal(executable.toString('ascii',0,2),'MZ');
const pe=executable.readUInt32LE(0x3c);
assert.equal(executable.toString('ascii',pe,pe+4),'PE\0\0');
assert.equal(executable.readUInt16LE(pe+4),0x8664,'Application must target Windows x64');
assert.equal(executable.readUInt16LE(pe+24),0x20b,'Application must be PE32+');
}
assert.equal(existsSync('dist/marx-core.exe'),false,'A stale workflow sidecar remains in dist');
assert.equal(executable.includes(Buffer.from('/$bunfs/')),false,'A Bun runtime was embedded');
assert.equal(executable.includes(Buffer.from('MARX_FIXTURE_ROOT')),false,'The test CLI fixture was packaged');
assert.equal(executable.includes(Buffer.from('MARX_INTEL_FIXTURE')),false,'Synthetic intelligence adapters must never be distributed');
if(!mac){
const nsis=readFileSync('build/windows.nsi','utf8');
assert.deepEqual([...nsis.matchAll(/^\s*File\s+"([^"]+)"/gm)].map(match=>match[1]),['..\\dist\\Marx.exe']);
}
const assets='native/frontend/dist/assets';
for(const view of ['ResultsView','BatchView','WorkbenchView','IntelligenceView','SettingsView','RemediationDialog']) {
 const file=readdirSync(assets).find(file=>file.startsWith(view+'-')&&file.endsWith('.js'));
 assert.ok(file,`${view} chunk is missing`);assert.ok(executable.includes(readFileSync(join(assets,file))),`${view} was not embedded`);
}
const go=process.env.GO_EXECUTABLE||Bun.which('go')||(!mac&&process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'MarxBuildTools/go/bin/go.exe'):undefined);
if(!go)throw new Error('Install the pinned Go toolchain.');
const metadata=execFileSync(go,['version','-m',executablePath],{encoding:'utf8'});
assert.match(metadata,new RegExp('GOARCH='+(mac?process.arch==='arm64'?'arm64':'amd64':'amd64')));
assert.match(metadata,new RegExp('GOOS='+(mac?'darwin':'windows')));assert.match(metadata,/modernc.org\/sqlite\s+v1\.61\.1/);
assert.match(metadata,/-trimpath=true/);
assert.doesNotMatch(metadata,/git\.sr\.ht\/\~jackmordaunt\/go-toast/,'Desktop toast support was linked into the application');
assert.equal(executable.includes(Buffer.from('/__marx_acceptance_result')),false,'Acceptance transport was packaged');
console.log(`${mac?'macOS Mach-O app bundle and ad hoc signature':'Windows x64 PE and single-executable installer payload'}, Go SQLite engine, embedded lazy views, and absence of test/runtime sidecars verified.`);
