import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
const mac=process.platform==='darwin';
const token=randomBytes(32).toString('hex');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'marx-wails-test-'));
const source=path.join(root,'source (native) [1] 日本語');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'index.js'),'const synthetic = true;');
const uncSource=process.env.MARX_VERIFY_UNC==='1'?`\\\\localhost\\${source[0]}$${source.slice(2)}`:null;
if(uncSource)assert.ok(fs.statSync(uncSource).isDirectory(),'Disposable loopback SMB source is unavailable');
const profile=path.join(root,'profile');fs.mkdirSync(profile);
const cli=path.join(root,mac?'cx':'cx.exe');
let proc: ReturnType<typeof spawn>|undefined;
let socket:WebSocket|undefined;
let runtimeStderr='';
function launch(executable:string){
 const child=spawn(executable,[],{cwd:os.tmpdir(),stdio:['ignore','ignore','pipe'],env:{...process.env,MARX_USER_DATA_DIR:profile,MARX_FIXTURE_ROOT:root,MARX_ACCEPTANCE_PORT:'19332',MARX_ACCEPTANCE_TOKEN:token,MARX_ACCEPTANCE_MINIMUM_SIZE:process.env.MARX_VERIFY_MINIMUM_SIZE||'',GORACE:'halt_on_error=1'}});
 child.stderr.on('data',chunk=>{runtimeStderr=(runtimeStderr+String(chunk)).slice(-1024*1024)});
 return child;
}
async function stopProcess(child:ReturnType<typeof spawn>){
 if(child.exitCode!==null||child.signalCode!==null)return;
 await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Native app did not exit after termination')),5000);
  child.once('exit',()=>{clearTimeout(timer);resolve()});
  child.kill('SIGKILL');
 });
}
async function run(args:string[]){const p=Bun.spawn(args,{stdout:'inherit',stderr:'inherit'});if(await p.exited)throw new Error('Verification build failed.');}
try {
 const go=process.env.GO_EXECUTABLE||Bun.which('go')||(!mac&&process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'MarxBuildTools/go/bin/go.exe'):undefined);
 if(!go)throw new Error('Install the pinned Go toolchain.');
 await run([go,'build','-trimpath','-buildvcs=false','-o',cli,'./scripts/fixtures/cli']);
 fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({cliPath:cli,cliAuthMode:'cli',recentFolders:[source,...(uncSource?[uncSource]:[])]}));
 const executable=process.env.MARX_TEST_EXECUTABLE;
 if(!executable)throw new Error('Set MARX_TEST_EXECUTABLE to an acceptance-tagged Wails build.');
 proc=launch(executable);
 const macEvaluate=async(expression:string)=>{const response=await fetch('http://127.0.0.1:19332/evaluate',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({expression}),signal:AbortSignal.timeout(65000)});if(!response.ok)throw new Error('Native evaluation failed: '+response.status);const result=await response.json() as any;if(result.error)throw new Error(result.error);return result.value;};
 const ready=async()=>{const end=Date.now()+30000;while(Date.now()<end){try{if((await fetch('http://127.0.0.1:19332/ready',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(1000)})).ok)return}catch{}await Bun.sleep(100)}throw new Error('Native WebView did not start')};
 if(mac)await ready();
 const deadline=Date.now()+30000;let target:any;
 while(!mac&&Date.now()<deadline&&!target){try{target=(await(await fetch('http://127.0.0.1:19332/json')).json() as any[]).find((t:any)=>t.type==='page')}catch{}if(!target)await Bun.sleep(100);}
 if(!mac){assert.ok(target,'Wails WebView did not start');socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise<void>((resolve,reject)=>{socket!.onopen=()=>resolve();socket!.onerror=()=>reject(new Error('WebView connection failed'))});}
 let sequence=0;const pending=new Map<number,(r:any)=>void>();
 const onMessage=(e:MessageEvent)=>{const m=JSON.parse(String(e.data));if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};if(socket)socket.onmessage=onMessage;
 const command=(method:string,params:any={})=>new Promise<any>((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('WebView operation timed out'))},60000);pending.set(id,result=>{clearTimeout(timer);resolve(result)});socket!.send(JSON.stringify({id,method,params}))});
 const evaluate=async(expression:string)=>{if(mac)return macEvaluate(expression);const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);return r.result?.result?.value};
 const wait=async(expression:string)=>{const end=Date.now()+30000;while(Date.now()<end){if(await evaluate(expression))return;await Bun.sleep(100)}throw new Error('Workflow did not settle')};
 await wait('!!window.marx');assert.equal((await evaluate('window.marx.settings.testConnection()')).ok,true);
 await evaluate(`(()=>{
  window.frameProbeRan=false;window.policyViolations=[];
  document.addEventListener('securitypolicyviolation',event=>window.policyViolations.push(event.effectiveDirective));
  window.addEventListener('message',event=>{if(event.data==='marx-frame-probe')window.frameProbeRan=true});
  for(const src of [location.origin+'/', 'https://example.invalid/marx-frame-probe']){
   const frame=document.createElement('iframe');frame.className='marx-frame-probe';frame.hidden=true;frame.src=src;document.body.append(frame);
  }
  const frame=document.createElement('iframe');frame.className='marx-frame-probe';frame.hidden=true;frame.srcdoc='<script>parent.postMessage("marx-frame-probe","*")<\\/script>';document.body.append(frame);
  const script=document.createElement('script');script.className='marx-frame-probe';script.src='https://example.invalid/marx-script-probe.js';document.body.append(script);
 })()`);
 await wait("window.policyViolations.filter(value=>value==='frame-src').length>=2&&window.policyViolations.some(value=>value.startsWith('script-src'))");
 assert.equal(await evaluate('window.frameProbeRan'),false,'An embedded frame executed script');
 await evaluate("document.querySelectorAll('.marx-frame-probe').forEach(element=>element.remove())");
 for(const name of ['Scan','Results','Batch Scan','Workbench','History','Settings']){await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`);await Bun.sleep(100);assert.ok(await evaluate('!!document.querySelector("main")?.textContent.trim()'))}
 const settings=await evaluate("window.marx.settings.setApiKey('disposable-wails-test')");assert.equal(settings.hasStoredApiKey,true);assert.ok(!fs.readFileSync(path.join(profile,'settings.key')).includes(Buffer.from('disposable-wails-test')));
 fs.writeFileSync(path.join(root,'expectedKey'),'disposable-wails-test');
 await evaluate("window.marx.settings.save({cliAuthMode:'marx'})");assert.equal((await evaluate('window.marx.settings.testConnection()')).ok,true);
 await evaluate("window.marx.settings.save({cliAuthMode:'cli'})");fs.rmSync(path.join(root,'expectedKey'));
 await evaluate('window.marx.workbench.saveWorkspace("native-test",{search:"persisted"})');assert.equal((await evaluate('window.marx.workbench.workspace("native-test")')).search,'persisted');
 await evaluate('window.marx.remediation.copy("Synthetic Wails clipboard")');
 fs.writeFileSync(path.join(root,'missingResults'),'synthetic');
 assert.equal(await evaluate("window.marx.results.get('malformed-zero').then(()=>false,()=>true)"),true,'Missing results must not be imported as a clean scan');
 fs.rmSync(path.join(root,'missingResults'));
 const large=await evaluate('window.marx.results.get("large-paging")');assert.equal(large.findings.length,5051);
 await evaluate('window.marx.onScanEvent(e=>{(window.testEvents??=[]).push(e)})');
 const binding=await evaluate(`window.marx.bindings.save(${JSON.stringify(source)},'p1')`);assert.equal(binding.projectId,'p1');
 if(process.env.MARX_VERIFY_EDITOR==='code')await evaluate(`window.marx.fs.openInEditor(${JSON.stringify(source)},'index.js',1,'p1','code')`);
 const input={folderPath:source,projectName:'synthetic-fixture',projectId:'p1',options:{scanners:['sast'],branch:'main',sastPreset:'',sastIncremental:false,scaExploitablePath:false,excludes:[],tags:{}}};
 const job=await evaluate(`window.marx.scan.run(${JSON.stringify(input)})`);
 await wait(`window.testEvents?.some(e=>e.kind==='job-updated'&&e.job.id===${JSON.stringify(job.id)}&&e.job.status==='Completed')`);
 const session=await evaluate(`window.marx.workbench.createSession({title:'Synthetic Wails remediation',scanId:'s1',findingIds:['finding-1']})`);
 assert.ok(session.id);await evaluate(`window.marx.workbench.updateSession({id:${JSON.stringify(session.id)},notes:'Synthetic notes'})`);
 assert.equal((await evaluate('window.marx.workbench.bootstrap()')).sessions[0].notes,'Synthetic notes');
 const exported=await evaluate(`window.marx.results.export('json','synthetic-wails',${JSON.stringify(large.findings.slice(0,2))})`);assert.equal(JSON.parse(fs.readFileSync(exported,'utf8')).findings.length,2);fs.rmSync(exported);

 const verify = await evaluate(`window.marx.workbench.verifySession({id:${JSON.stringify(session.id)},scanId:'s2'})`);
 assert.equal(verify.verification.comparison.verdict,'inconclusive');
 if(uncSource){
  assert.equal((await evaluate(`window.marx.bindings.save(${JSON.stringify(uncSource)},'p1')`)).projectId,'p1');
  assert.ok((await evaluate(`window.marx.fs.readSourceFile(${JSON.stringify(uncSource)},'index.js',1,'p1')`)).lines.join('\n').includes('synthetic'));
  const uncJob=await evaluate(`window.marx.scan.run(${JSON.stringify({...input,folderPath:uncSource})})`);
  await wait(`window.marx.scan.jobs().then(jobs=>jobs.some(job=>job.id===${JSON.stringify(uncJob.id)}&&job.status==='Completed'))`);
 }
 fs.rmSync(path.join(root,'submissionStarted'),{force:true});
 fs.writeFileSync(path.join(root,'holdSubmission'),'hold');
 const held=await evaluate(`window.marx.scan.run(${JSON.stringify(input)})`);const submissionDeadline=Date.now()+15000;while(!fs.existsSync(path.join(root,'submissionStarted'))&&Date.now()<submissionDeadline)await Bun.sleep(50);assert.ok(fs.existsSync(path.join(root,'submissionStarted')));
 await evaluate(`window.marx.scan.cancelJob(${JSON.stringify(held)})`);
 await wait(`window.marx.scan.jobs().then(jobs=>jobs.some(j=>j.id===${JSON.stringify(held.id)}&&j.status==='Unknown'))`);
 await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Results').click()`);
 await wait(`!!document.querySelector('[aria-label="Scan"] option[value="large-paging"]')`);
 await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Scan"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'large-paging');e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await wait(`document.querySelectorAll('.finding-link').length===100`);
 const toolbar=await evaluate(`(()=>{const select=document.querySelector('.scan-picker select').getBoundingClientRect();const buttons=Array.from(document.querySelectorAll('.result-scan-toolbar > .btn,.result-scan-toolbar > .export-menu > summary')).map(element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right}});return {width:innerWidth,select:{top:select.top,bottom:select.bottom,height:select.height},buttons}})()`);
 assert.equal(toolbar.buttons.length,3);
 for(const button of toolbar.buttons){assert.equal(button.height,toolbar.select.height);assert.equal(button.top,toolbar.select.top);assert.equal(button.bottom,toolbar.select.bottom);assert.ok(button.left>=0&&button.right<=toolbar.width);}
 fs.rmSync(path.join(root,'holdSubmission'));fs.writeFileSync(path.join(root,'running'),'running');
 const recovering=await evaluate(`window.marx.scan.run(${JSON.stringify(input)})`);
 await wait(`window.marx.scan.jobs().then(jobs=>jobs.some(j=>j.id===${JSON.stringify(recovering.id)}&&j.scanId&&j.status==='Running'))`);
 fs.rmSync(path.join(root,'submissionStarted'),{force:true});fs.writeFileSync(path.join(root,'holdSubmission'),'hold');
 const uncertain=await evaluate(`window.marx.scan.run(${JSON.stringify(input)})`);
 const crashDeadline=Date.now()+15000;while(!fs.existsSync(path.join(root,'submissionStarted'))&&Date.now()<crashDeadline)await Bun.sleep(50);assert.ok(fs.existsSync(path.join(root,'submissionStarted')));
 const childPID=Number(fs.readFileSync(path.join(root,'submissionPID'),'utf8'));const submissions=fs.readFileSync(path.join(root,'counter'),'utf8');
 socket?.close();await stopProcess(proc);await Bun.sleep(1000);
 let orphan=false;try{process.kill(childPID,0);orphan=true}catch{}assert.equal(orphan,false,'CLI process survived the host crash');fs.rmSync(path.join(root,'running'));fs.rmSync(path.join(root,'holdSubmission'));
 proc=launch(executable);
 if(mac)await ready();
 let restarted:any;const end=Date.now()+30000;
 while(!mac&&Date.now()<end&&!restarted){try{restarted=(await(await fetch('http://127.0.0.1:19332/json')).json() as any[]).find((t:any)=>t.type==='page')}catch{}if(!restarted)await Bun.sleep(100);}
 if(!mac){assert.ok(restarted);socket=new WebSocket(restarted.webSocketDebuggerUrl);await new Promise<void>(resolve=>socket!.onopen=()=>resolve());if(socket)socket.onmessage=onMessage;}
 await wait('!!window.marx');assert.equal((await evaluate('window.marx.workbench.workspace("native-test")')).search,'persisted');
 assert.equal((await evaluate('window.marx.workbench.bootstrap()')).sessions[0].notes,'Synthetic notes');
 assert.ok((await evaluate('window.marx.scan.jobs()')).some((j:any)=>j.status==='Unknown'));
 await wait(`window.marx.scan.jobs().then(jobs=>jobs.some(j=>j.id===${JSON.stringify(recovering.id)}&&j.status==='Completed'))`);
 assert.ok((await evaluate('window.marx.scan.jobs()')).some((j:any)=>j.id===uncertain.id&&j.status==='Unknown'&&!j.scanId));assert.equal(fs.readFileSync(path.join(root,'counter'),'utf8'),submissions);
 assert.equal(runtimeStderr.includes('DATA RACE'),false,'The native runtime reported a data race');
 console.log(JSON.stringify({result:'passed',checks:[mac?'Wails WKWebView startup':'Wails WebView2 startup','all views','frame and remote-script CSP enforcement','native CLI bridge',mac?'macOS Keychain-backed encryption and decryption':'Windows DPAPI encryption and decryption','SQLite persistence','real clipboard IPC','5051 findings imported by Go','scan submission, monitoring and native event delivery','remediation notes','JSON export','inconclusive verification','uncertain cancellation','100-row GUI paging','Results toolbar alignment','known-ID restart recovery without resubmission','CLI child cleanup after host crash',...(uncSource?['loopback SMB/UNC source read and scan']:[]),...(process.env.MARX_VERIFY_EDITOR==='code'?['VS Code protocol launch request']:[])],evidence:mac?'$TMPDIR/marx-wails-test-<generated>':'%TEMP%/marx-wails-test-<generated>'},null,2));
 if(!mac)await command('Browser.close').catch(()=>{});
} catch(error) {fs.writeFileSync(path.join(root,'runtime-stderr.log'),runtimeStderr);console.error('Wails acceptance failed:',String(error).replaceAll(root,'<fixture>').replaceAll(os.homedir(),'%USERPROFILE%').replaceAll(os.homedir().replaceAll('\\','/'),'%USERPROFILE%'));process.exitCode=1;} finally {
 socket?.close();
 if(proc)await stopProcess(proc);
 if(mac){try{execFileSync('/usr/bin/security',['delete-generic-password','-s','com.marx.scanner.credentials','-a',createHash('sha256').update(fs.realpathSync(profile)).digest('hex')],{stdio:'ignore',timeout:5000});}catch{}}
}
