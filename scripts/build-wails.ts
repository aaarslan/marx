import {mkdir,rm,copyFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {version} from '../package.json';
const mac = process.platform === 'darwin';
if (!mac && process.platform !== 'win32') throw new Error('Build Marx natively on macOS or Windows.');
if(process.argv.includes('--mac')&&!mac)throw new Error('Build the macOS bundle natively on macOS.');
if(process.argv.includes('--windows')&&mac)throw new Error('Build the Windows package natively on Windows.');
if (mac && process.argv.includes('--installer')) throw new Error('The NSIS installer requires Windows. Use dist:mac on macOS.');
const go = process.env.GO_EXECUTABLE || Bun.which('go') || (!mac&&process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'MarxBuildTools/go/bin/go.exe'):undefined);
if (!go) throw new Error('Install the Go version in .go-version or set GO_EXECUTABLE.');
async function run(command: string[]) {
 const p=Bun.spawn(command,{cwd:resolve('.'),stdout:'inherit',stderr:'inherit',env:mac?{...process.env,MACOSX_DEPLOYMENT_TARGET:'13.0',CGO_CFLAGS:`${process.env.CGO_CFLAGS||'-O2 -g'} -mmacosx-version-min=13.0`}:process.env});
 if(await p.exited!==0)throw new Error(`Build command failed: ${command[0]}`);
}
if(process.argv.includes('--start')) { await run([resolve(mac?'dist/Marx.app/Contents/MacOS/Marx':'dist/Marx.exe')]); process.exit(0); }
await mkdir('dist',{recursive:true});
await rm('dist/marx-core.exe',{force:true});
await run(['bun','--bun','vite','build']);
let executable = resolve('dist/Marx.exe');
if(mac){
 const contents=resolve('dist/Marx.app/Contents');
 await rm(resolve('dist/Marx.app'),{recursive:true,force:true});
 await mkdir(join(contents,'MacOS'),{recursive:true});
 await mkdir(join(contents,'Resources'),{recursive:true});
 await copyFile('build/icon.icns',join(contents,'Resources/icon.icns'));
 await writeFile(join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.marx.scanner</string>
<key>CFBundleName</key><string>Marx</string>
<key>CFBundleDisplayName</key><string>Marx</string>
<key>CFBundleExecutable</key><string>Marx</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>\n`);
 executable=join(contents,'MacOS/Marx');
}else await run([go,'run','./tools/resources']);
await run([go,'build','-trimpath','-buildvcs=false','-tags','production','-ldflags',mac?'-s -w -extldflags=-mmacosx-version-min=13.0':'-s -w -H windowsgui','-o',executable,'./native']);
if(mac) await run(['codesign','--force','--deep','--sign','-',resolve('dist/Marx.app')]);
if(process.argv.includes('--installer'))await run([process.env.NSIS_EXECUTABLE || Bun.which('makensis') || 'makensis','/V2','build/windows.nsi']);
if(process.argv.includes('--run'))await run([executable]);
