import {mkdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const go = process.env.GO_EXECUTABLE || Bun.which('go') || join(process.env.LOCALAPPDATA!, 'MarxBuildTools/go/bin/go.exe');
async function run(command: string[]) {
 const p=Bun.spawn(command,{cwd:resolve('.'),stdout:'inherit',stderr:'inherit',env:process.env});
 if(await p.exited!==0)throw new Error(`Build command failed: ${command[0]}`);
}
await mkdir('dist',{recursive:true});
await rm('dist/marx-core.exe',{force:true});
await run(['bun','--bun','vite','build']);
await run([go,'run','./tools/resources']);
await run([go,'build','-trimpath','-buildvcs=false','-tags','production','-ldflags','-s -w -H windowsgui','-o','dist/Marx.exe','./native']);
if(process.argv.includes('--installer'))await run([process.env.NSIS_EXECUTABLE || Bun.which('makensis') || 'makensis','/V2','build/windows.nsi']);
if(process.argv.includes('--run'))await run([resolve('dist/Marx.exe')]);
