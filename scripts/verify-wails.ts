import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'marx-wails-test-'));
const source=path.join(root,'source (native) [1]');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'index.js'),'const synthetic = true;');
const profile=path.join(root,'profile');fs.mkdirSync(profile);
const cli=path.join(root,'cx.exe');
let proc: ReturnType<typeof spawn>|undefined;
let socket:WebSocket|undefined;
async function run(args:string[]){const p=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'});if(await p.exited)throw new Error('Verification build failed.');}
try {
 await run(['bun','build','scripts/fixtures/synthetic-cli.cjs','--compile','--outfile',cli]);
 fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({cliPath:cli,cliAuthMode:'cli',recentFolders:[source]}));
 const executable=process.env.MARX_TEST_EXECUTABLE;
 if(!executable)throw new Error('Set MARX_TEST_EXECUTABLE to an acceptance-tagged Wails build.');
 proc=spawn(executable,[],{cwd:os.tmpdir(),stdio:'ignore',env:{...process.env,MARX_USER_DATA_DIR:profile,MARX_FIXTURE_ROOT:root,MARX_ACCEPTANCE_PORT:'19332'}});
 const deadline=Date.now()+30000;let target:any;
 while(Date.now()<deadline&&!target){try{target=(await(await fetch('http://127.0.0.1:19332/json')).json()).find((t:any)=>t.type==='page')}catch{}if(!target)await Bun.sleep(100);}
 assert.ok(target,'Wails WebView did not start');socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise<void>((resolve,reject)=>{socket!.onopen=()=>resolve();socket!.onerror=()=>reject(new Error('WebView connection failed'))});
 let sequence=0;const pending=new Map<number,(r:any)=>void>();
 const onMessage=(e:MessageEvent)=>{const m=JSON.parse(String(e.data));if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};socket.onmessage=onMessage;
 const command=(method:string,params:any={})=>new Promise<any>((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('WebView operation timed out'))},60000);pending.set(id,result=>{clearTimeout(timer);resolve(result)});socket!.send(JSON.stringify({id,method,params}))});
 const evaluate=async(expression:string)=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);return r.result?.result?.value};
 const wait=async(expression:string)=>{const end=Date.now()+30000;while(Date.now()<end){if(await evaluate(expression))return;await Bun.sleep(100)}throw new Error('Workflow did not settle')};
 await wait('!!window.marx');assert.equal((await evaluate('window.marx.settings.testConnection()')).ok,true);
 for(const name of ['Scan','Results','Batch Scan','Workbench','Settings']){await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`);await Bun.sleep(100);assert.ok(await evaluate('!!document.querySelector("main")?.textContent.trim()'))}
 const settings=await evaluate("window.marx.settings.setApiKey('disposable-wails-test')");assert.equal(settings.hasStoredApiKey,true);assert.ok(!fs.readFileSync(path.join(profile,'settings.key')).includes(Buffer.from('disposable-wails-test')));
 await evaluate('window.marx.workbench.saveWorkspace("native-test",{search:"persisted"})');assert.equal((await evaluate('window.marx.workbench.workspace("native-test")')).search,'persisted');
 await evaluate('window.marx.remediation.copy("Synthetic Wails clipboard")');
 const large=await evaluate('window.marx.results.get("large-paging")');assert.equal(large.findings.length,5051);
 await evaluate('window.marx.onScanEvent(e=>{(window.testEvents??=[]).push(e)})');
 const binding=await evaluate(`window.marx.bindings.save(${JSON.stringify(source)},'p1')`);assert.equal(binding.projectId,'p1');
 const input={folderPath:source,projectName:'synthetic-fixture',projectId:'p1',options:{scanners:['sast'],branch:'main',sastPreset:'',sastIncremental:false,scaExploitablePath:false,excludes:[],tags:{}}};
 const job=await evaluate(`window.marx.scan.run(${JSON.stringify(input)})`);
 await wait(`window.testEvents?.some(e=>e.kind==='job-updated'&&e.job.id===${JSON.stringify(job.id)}&&e.job.status==='Completed')`);
 const session=await evaluate(`window.marx.workbench.createSession({title:'Synthetic Wails remediation',scanId:'s1',findingIds:['finding-1']})`);
 assert.ok(session.id);await evaluate(`window.marx.workbench.updateSession({id:${JSON.stringify(session.id)},notes:'Synthetic notes'})`);
 assert.equal((await evaluate('window.marx.workbench.bootstrap()')).sessions[0].notes,'Synthetic notes');
 const exported=await evaluate(`window.marx.results.export('json','synthetic-wails',${JSON.stringify(large.findings.slice(0,2))})`);assert.equal(JSON.parse(fs.readFileSync(exported,'utf8')).findings?.length??JSON.parse(fs.readFileSync(exported,'utf8')).length,2);

 const verify = await evaluate(`window.marx.workbench.verifySession({id:${JSON.stringify(session.id)},scanId:'s2'})`);
 assert.equal(verify.verification.comparison.verdict,'inconclusive');
 fs.writeFileSync(path.join(root,'holdSubmission'),'hold');
 const held=await evaluate(`window.marx.scan.run(${JSON.stringify(input)})`);await Bun.sleep(500);
 await evaluate(`window.marx.scan.cancelJob(${JSON.stringify(held)})`);
 await wait(`window.marx.scan.jobs().then(jobs=>jobs.some(j=>j.id===${JSON.stringify(held.id)}&&j.status==='Unknown'))`);
 await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Results').click()`);
 await wait(`!!document.querySelector('[aria-label="Scan"] option[value="large-paging"]')`);
 await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Scan"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'large-paging');e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await wait(`document.querySelectorAll('.finding-link').length===100`);
 const encrypted=fs.readFileSync(path.join(profile,'settings.key'));
 const decrypted=Bun.spawn([executable,'--credential','unprotect'],{stdin:encrypted,stdout:'pipe',stderr:'pipe'});
 assert.equal(await new Response(decrypted.stdout).text(),'disposable-wails-test');assert.equal(await decrypted.exited,0);
 socket.close();proc.kill();await new Promise<void>(resolve=>proc!.once('exit',()=>resolve()));await Bun.sleep(1000);
 proc=spawn(executable,[],{cwd:os.tmpdir(),stdio:'ignore',env:{...process.env,MARX_USER_DATA_DIR:profile,MARX_FIXTURE_ROOT:root,MARX_ACCEPTANCE_PORT:'19332'}});
 let restarted:any;const end=Date.now()+30000;
 while(Date.now()<end&&!restarted){try{restarted=(await(await fetch('http://127.0.0.1:19332/json')).json()).find((t:any)=>t.type==='page')}catch{}if(!restarted)await Bun.sleep(100);}
 assert.ok(restarted);socket=new WebSocket(restarted.webSocketDebuggerUrl);await new Promise<void>(resolve=>socket!.onopen=()=>resolve());socket.onmessage=onMessage;
 await wait('!!window.marx');assert.equal((await evaluate('window.marx.workbench.workspace("native-test")')).search,'persisted');
 assert.equal((await evaluate('window.marx.workbench.bootstrap()')).sessions[0].notes,'Synthetic notes');
 assert.ok((await evaluate('window.marx.scan.jobs()')).some((j:any)=>j.status==='Unknown'));
 console.log(JSON.stringify({result:'passed',checks:['Wails WebView2 startup','all views','native CLI bridge','Windows DPAPI encryption','SQLite persistence','real clipboard IPC','5051 findings and report worker','scan submission, monitoring and native event delivery','remediation notes','JSON export','DPAPI decryption','inconclusive verification','uncertain cancellation','100-row GUI paging','restart recovery'],evidence:'%TEMP%/marx-wails-test-<generated>'},null,2));
 await command('Browser.close').catch(()=>{});
} catch(error) {console.error('Wails acceptance failed:',String(error).replaceAll(root,'<fixture>'));process.exitCode=1;} finally {socket?.close();if(proc&&!proc.killed)proc.kill();}
