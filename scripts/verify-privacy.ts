import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
const root=homedir();
const homes=[root,root.replaceAll('\\','/'),root.replaceAll('\\','\\\\')].filter(Boolean);
const files=execFileSync('git',['diff','--cached','--name-only','--diff-filter=ACMR','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const file of files){const data=readFileSync(file);for(const value of homes)if(data.includes(Buffer.from(value))||data.includes(Buffer.from(value,'utf16le')))throw new Error(`Personal home-directory path found in staged file: ${file}`);}
for(const file of ['dist/Marx.app/Contents/MacOS/Marx','dist/Marx.exe','dist/Marx-0.9.0-win-x64-setup.exe']){if(!existsSync(file))continue;const data=readFileSync(file);for(const value of homes)if(data.includes(Buffer.from(value))||data.includes(Buffer.from(value,'utf16le')))throw new Error(`Personal home-directory path found in executable: ${file}`);}
console.log('Staged files and release executables contain no local home-directory paths.');
