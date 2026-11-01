import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve('.cache/showcase/render');
fs.mkdirSync(path.join(root,'assets'),{recursive:true});
fs.cpSync('showcase/compositions',path.join(root,'compositions'),{recursive:true});
fs.copyFileSync('showcase/index.html',path.join(root,'index.html'));
fs.copyFileSync('showcase/film.css',path.join(root,'assets/film.css'));
fs.copyFileSync('docs/icon.png',path.join(root,'assets/icon.png'));
for(const name of ['scan','results','detail','prompt','workbench'])fs.copyFileSync(`docs/assets/${name}.webp`,path.join(root,`assets/${name}.webp`));
const response=await fetch('https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js',{signal:AbortSignal.timeout(20000)});
if(!response.ok)throw new Error('Unable to obtain pinned animation runtime');
const gsap=Buffer.from(await response.arrayBuffer());
if(createHash('sha256').update(gsap).digest('hex')!=='92bb9a96476f983d212a2bc4f54c889039c1696dd4461d40a736860938570fbb')throw new Error('Animation runtime checksum mismatch');
fs.writeFileSync(path.join(root,'assets/gsap.min.js'),gsap);
execFileSync('python3',['showcase/soundtrack.py',path.join(root,'assets/score.wav')]);
execFileSync('ffmpeg',['-y','-v','error','-i',path.join(root,'assets/score.wav'),'-c:a','aac','-b:a','128k',path.join(root,'assets/soundtrack.m4a')]);
if(process.argv.includes('--render')){
 const binary=process.env.HYPERFRAMES_EXECUTABLE;
 const args=['render',root,'--output',path.resolve('docs/assets/marx-showcase.mp4'),'--fps','30','--quality','delivery','--workers','2'];
 execFileSync(binary||'npx',binary?args:['--yes','hyperframes@0.8.226',...args],{stdio:'inherit',env:{...process.env,HYPERFRAMES_NO_TELEMETRY:'1',HYPERFRAMES_NO_UPDATE_CHECK:'1'}});
}
console.log('Prepared local showcase at .cache/showcase/render');
