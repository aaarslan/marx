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
fs.writeFileSync(path.join(root,'.synthetic-marx-fixture'),'Isolated synthetic acceptance');
const profile=path.join(root,'profile');fs.mkdirSync(profile);
const cli=path.join(root,mac?'cx':'cx.exe');
let proc: ReturnType<typeof spawn>|undefined;
let socket:WebSocket|undefined;
let runtimeStderr='';
function keychainAccount(){
 const blob=fs.readFileSync(path.join(profile,'settings.key'));
 const identity=createHash('sha256').update(fs.realpathSync(profile)).digest('hex');
 return blob.subarray(0,8).toString('ascii')==='MARXKEY2'?identity+'.'+blob.subarray(8,24).toString('hex'):identity;
}
function removeKeychainEntry(){execFileSync('/usr/bin/security',['delete-generic-password','-s','com.marx.scanner.credentials','-a',keychainAccount()],{stdio:'ignore',timeout:5000});}
function launch(executable:string){
 const child=spawn(executable,[],{cwd:os.tmpdir(),stdio:['ignore','ignore','pipe'],env:{...process.env,MARX_INTEL_FIXTURE:'1',MARX_USER_DATA_DIR:profile,MARX_FIXTURE_ROOT:root,MARX_ACCEPTANCE_PORT:'19332',MARX_ACCEPTANCE_TOKEN:token,MARX_ACCEPTANCE_MINIMUM_SIZE:process.env.MARX_VERIFY_MINIMUM_SIZE||'',GORACE:'halt_on_error=1'}});
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
 const selectedExecutable=process.env.MARX_TEST_EXECUTABLE;
 if(!selectedExecutable)throw new Error('Set MARX_TEST_EXECUTABLE to an acceptance-tagged Wails build.');
 const executable=mac&&process.env.MARX_UPGRADE_TEST_EXECUTABLE?path.join(root,'Marx-upgrade-test'):selectedExecutable;
 if(executable!==selectedExecutable){fs.copyFileSync(selectedExecutable,executable);fs.chmodSync(executable,0o700);}
 proc=launch(executable);
 const macEvaluate=async(expression:string)=>{const response=await fetch('http://127.0.0.1:19332/evaluate',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({expression}),signal:AbortSignal.timeout(65000)});if(!response.ok)throw new Error('Native evaluation failed: '+response.status+' while evaluating '+expression.slice(0,300));const result=await response.json() as any;if(result.error)throw new Error(result.error);return result.value;};
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
 const wait=async(expression:string)=>{const end=Date.now()+30000;while(Date.now()<end){if(await evaluate(expression))return;await Bun.sleep(100)}throw new Error('Workflow did not settle: '+expression)};
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
 await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Settings').click()`);
 await wait(`!!document.querySelector('.settings-actions')`);
 const shellScroll=await evaluate(`(()=>{document.querySelector('.settings-actions button').scrollIntoView();for(const element of [document.documentElement,document.body,document.querySelector('#root')])element.scrollTop=10000;const sidebar=document.querySelector('.sidebar').getBoundingClientRect();return {top:sidebar.top,bottom:sidebar.bottom,height:innerHeight,outerScroll:document.scrollingElement.scrollTop,mainScroll:document.querySelector('main').scrollTop}})()`);
 assert.equal(shellScroll.outerScroll,0,'Settings focus scrolled the outer document');assert.ok(shellScroll.top>=-1&&shellScroll.bottom<=shellScroll.height+1,'Settings focus moved navigation outside the window');assert.ok(shellScroll.mainScroll>0,'Settings did not scroll within its content pane');
 assert.equal(await evaluate(`document.querySelector('.connection-dot').classList.contains('configured')`),false,'CLI configuration used an unconditional success indicator');
 fs.renameSync(cli,cli+'.offline');
 try {
  await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Results').click()`);
  await wait(`document.querySelector('.banner.warn')?.textContent.includes('Recent remote scans could not be refreshed')`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Load demo results').click()`);
  await wait(`document.querySelector('main').textContent.includes('Demo scan')`);
  assert.equal(await evaluate(`!!document.querySelector('.banner.warn')`),false,'A remote history warning leaked into the local demo');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Close demo').click()`);
  await wait(`!!document.querySelector('.banner.warn')`);
 } finally { fs.renameSync(cli+'.offline',cli); }
 await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Settings').click()`);
 const settings=await evaluate("window.marx.settings.setApiKey('disposable-wails-test')");assert.equal(settings.hasStoredApiKey,true);assert.ok(!fs.readFileSync(path.join(profile,'settings.key')).includes(Buffer.from('disposable-wails-test')));
 fs.writeFileSync(path.join(root,'expectedKey'),'disposable-wails-test');
 await evaluate("window.marx.settings.save({cliAuthMode:'marx'})");assert.equal((await evaluate('window.marx.settings.testConnection()')).ok,true);
 if(mac){
  const previous=fs.readFileSync(path.join(profile,'settings.key'));
  removeKeychainEntry();
  assert.equal(await evaluate("window.marx.settings.testConnection().then(()=>false,()=>true)"),true,'Missing Keychain entry was not rejected');
  assert.equal((await evaluate('window.marx.settings.get()')).credentialStorageAvailable,true,'A missing entry disabled credential replacement');
  await evaluate("window.marx.settings.setApiKey('disposable-wails-test')");
  assert.notDeepEqual(fs.readFileSync(path.join(profile,'settings.key')),previous);
  assert.equal((await evaluate('window.marx.settings.testConnection()')).ok,true);
 }
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
 assert.deepEqual((await evaluate('window.marx.intelligence.settings()')).enabledSources,[]);
 fs.writeFileSync(path.join(root,'intel-demo'),'synthetic intelligence scan');
 const intelPage=await evaluate('window.marx.results.get("intel-demo")');
 assert.equal(intelPage.findings.length,2);
 assert.equal(await evaluate('window.marx.intelligence.refresh({cves:["CVE-2024-1234"],requestId:"disabled"}).then(()=>false,()=>true)'),true);
 await evaluate('window.marx.intelligence.configure(["kev","epss","cve"])');
 await evaluate('window.marx.intelligence.watch("CVE-2024-1234")');
 const intelData=await evaluate('window.marx.intelligence.refresh({cves:["CVE-2024-1234","CVE-2021-44228"],requestId:"native-intel",force:true})');
 assert.equal(intelData['CVE-2024-1234'].synthetic,true);
 await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='CVE intelligence').click()`);
 assert.equal(intelData['CVE-2024-1234'].sources.find((item:any)=>item.source==='kev').value.listed,false);
 await wait(`!!document.querySelector('#cve-lookup')`);
 await evaluate(`(()=>{const e=document.querySelector('#cve-lookup');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'CWE-79');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await evaluate(`document.querySelector('.intel-lookup').requestSubmit()`);
 await wait(`document.querySelector('#cve-lookup').getAttribute('aria-invalid')==='true'`);
 assert.equal(await evaluate(`document.activeElement.id`),'cve-lookup');
 await evaluate(`(()=>{const e=document.querySelector('#cve-lookup');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'cve-2024-1234');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await evaluate(`document.querySelector('.intel-lookup').requestSubmit()`);
 await wait(`document.querySelector('.intel-detail-header button')?.getAttribute('aria-pressed')==='true'`);
 await evaluate(`(()=>{document.querySelector('.intel-detail-header button').focus();document.querySelector('.intel-detail-header button').click()})()`);
 await wait(`document.querySelector('.intel-detail-header button')?.getAttribute('aria-pressed')==='false'`);
 assert.equal(await evaluate(`document.activeElement.matches('.intel-detail-header button')`),true,'Watch toggle lost keyboard focus');
 await evaluate(`document.querySelector('.intel-detail-header button').click()`);
 await wait(`document.querySelector('.intel-detail-header button')?.getAttribute('aria-pressed')==='true'`);
 assert.equal((await evaluate('window.marx.intelligence.watchlist()')).items.length,1);

 await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Results').click()`);
 await wait(`!!document.querySelector('select[aria-label="Scan"] option[value="intel-demo"]')`);
 await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Scan"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'intel-demo');e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await wait(`document.querySelectorAll('.finding-link').length===2`);
 await evaluate(`document.querySelector('.finding-link').click()`);
 await wait(`!!document.querySelector('.intel-panel > summary')`);
 await evaluate(`document.querySelector('.intel-panel > summary').click()`);
 await wait(`document.querySelector('.intel-panel').textContent.includes('2.00%')`);
 await evaluate(`Array.from(document.querySelectorAll('.intel-panel button')).find(b=>b.textContent.trim()==='Record decision').click()`);
 await wait(`!!document.querySelector('dialog[open] textarea[aria-label="Decision rationale"]')`);
 await evaluate(`(()=>{const e=document.querySelector('textarea[aria-label="Decision rationale"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Synthetic deferral pending compatible update; review if exploitation changes.');e.dispatchEvent(new Event('input',{bubbles:true}));const inputs=document.querySelectorAll('.decision-dialog fieldset input[type="checkbox"]');inputs[0].click();inputs[1].click();})()`);
 await evaluate(`Array.from(document.querySelectorAll('.decision-dialog button')).find(b=>b.textContent.trim()==='Save decision').click()`);
 await wait(`!document.querySelector('dialog[open]')`);
 const nativeDecision=(await evaluate('window.marx.intelligence.decisions()'))[0];assert.equal(nativeDecision.verdict,'defer');assert.equal(nativeDecision.revision,1);
 assert.equal(nativeDecision.evidence.sources.find((item:any)=>item.source==='epss').value.probability,0.02);
 fs.writeFileSync(path.join(root,'intel-escalate'),'synthetic escalation');
 await evaluate('window.marx.intelligence.refresh({cves:["CVE-2024-1234"],requestId:"native-escalation",force:true})');
 const reviewedDecision=(await evaluate('window.marx.intelligence.decisions()'))[0];assert.equal(reviewedDecision.reviewState,'needs_review');assert.equal(reviewedDecision.reviewReasons.length,2);
 assert.equal(reviewedDecision.evidence.sources.find((item:any)=>item.source==='epss').value.probability,0.02);
 assert.equal(reviewedDecision.currentEvidence.sources.find((item:any)=>item.source==='epss').value.probability,0.42);
 await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Workbench').click()`);
 await wait(`!!document.querySelector('#decisions-tab')`);await evaluate(`document.querySelector('#decisions-tab').click()`);
 await wait(`document.querySelector('.session-list')?.textContent.includes('needs review')`);
 await evaluate(`document.querySelector('.session-card').click()`);
 await wait(`document.querySelector('.decision-detail')?.textContent.includes('The CVE is now listed in CISA KEV')`);
 await evaluate(`document.querySelector('.decision-detail > .row button').click()`);
 await wait(`document.activeElement.matches('[data-decision-id]')`);
 await evaluate(`document.activeElement.click()`);
 await wait(`!!document.querySelector('.decision-detail')`);

 await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='CVE intelligence').click()`);
 await wait(`document.querySelector('.intel-watch')?.textContent.includes('CVE-2024-1234')`);
 assert.ok((await evaluate('window.marx.intelligence.watchlist()')).events.length>0);
 assert.equal(await evaluate(`Array.from(document.querySelectorAll('.page-content *')).some(e=>e.getBoundingClientRect().right>innerWidth+2)`),false,'CVE intelligence layout exceeds the native window');
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

 if(mac&&process.env.MARX_UPGRADE_TEST_EXECUTABLE){
  fs.writeFileSync(path.join(root,'expectedKey'),'disposable-upgrade-key');
  await evaluate("window.marx.settings.setApiKey('disposable-upgrade-key')");
  await evaluate("window.marx.settings.save({cliAuthMode:'marx'})");
  assert.equal((await evaluate('window.marx.settings.testConnection()')).ok,true);
  await stopProcess(proc);
  const replacement=fs.readFileSync(process.env.MARX_UPGRADE_TEST_EXECUTABLE);
  assert.notEqual(createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),createHash('sha256').update(replacement).digest('hex'),'App replacement must change the executable bytes');
  const replacedExecutable=process.env.MARX_UPGRADE_RELOCATE==='1'?path.join(root,'Marx-relocated-test'):executable;
  fs.copyFileSync(process.env.MARX_UPGRADE_TEST_EXECUTABLE,replacedExecutable);
  fs.chmodSync(replacedExecutable,0o700);
  proc=launch(replacedExecutable);
  await ready();await wait('!!window.marx');
  console.log('Checking saved credential after executable replacement.');
  const readable=await evaluate("window.marx.settings.testConnection().then(()=>true,()=>false)");
  console.log('Replacement credential read completed:',readable);
  if(!readable){
   assert.equal((await evaluate('window.marx.settings.get()')).credentialStorageAvailable,true);
   console.log('Saving a replacement credential.');
   await evaluate("window.marx.settings.setApiKey('disposable-upgrade-key')");
   assert.equal((await evaluate('window.marx.settings.testConnection()')).ok,true);
  }
  console.log(JSON.stringify({appReplacement:readable?'saved key remained readable':'OS access denied; explicit key replacement recovered',plaintextFallback:false}));
  console.log('Removing the disposable upgrade credential.');
  await evaluate("window.marx.settings.setApiKey('')");
  assert.equal((await evaluate('window.marx.settings.get()')).hasStoredApiKey,false);
 }
 assert.equal((await evaluate('window.marx.intelligence.decisions()'))[0].reviewState,'needs_review');
 assert.equal(runtimeStderr.includes('DATA RACE'),false,'The native runtime reported a data race');
 console.log(JSON.stringify({result:'passed',checks:[mac?'Wails WKWebView startup':'Wails WebView2 startup','all views','frame and remote-script CSP enforcement','native CLI bridge',mac?'macOS Keychain encryption and missing-entry recovery':'Windows DPAPI encryption and decryption','SQLite persistence','real clipboard IPC','5051 findings imported by Go','scan submission, monitoring and native event delivery','remediation notes','JSON export','inconclusive verification','uncertain cancellation','100-row GUI paging','Results toolbar alignment','opt-in intelligence with synthetic providers','native decision dialog and assumptions','changed evidence review and immutable pins','watch events and decision persistence','CVE validation focus, watch toggle and decision return focus','honest CLI setup state and isolated demo warning recovery','known-ID restart recovery without resubmission','CLI child cleanup after host crash',...(uncSource?['loopback SMB/UNC source read and scan']:[]),...(process.env.MARX_VERIFY_EDITOR==='code'?['VS Code protocol launch request']:[])],evidence:mac?'$TMPDIR/marx-wails-test-<generated>':'%TEMP%/marx-wails-test-<generated>'},null,2));
 if(!mac)await command('Browser.close').catch(()=>{});
} catch(error) {fs.writeFileSync(path.join(root,'runtime-stderr.log'),runtimeStderr);console.error('Wails acceptance failed:',String(error).replaceAll(root,'<fixture>').replaceAll(os.homedir(),'%USERPROFILE%').replaceAll(os.homedir().replaceAll('\\','/'),'%USERPROFILE%'));process.exitCode=1;} finally {
 socket?.close();
 if(proc)await stopProcess(proc);
 if(mac){try{removeKeychainEntry();}catch{}}
}
