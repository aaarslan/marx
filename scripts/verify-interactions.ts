import assert from 'node:assert/strict';

type Evaluate = (expression: string) => Promise<any>;
type Wait = (expression: string) => Promise<void>;

export async function verifyConnectionTestIdentity(evaluate: Evaluate, wait: Wait) {
  await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Settings').click()`);
  await wait(`!!document.querySelector('.settings-connection-check button')`);
  await evaluate(`(()=>{
    window.connectionProbe={original:window.marx.settings.testConnection};
    window.marx.settings.testConnection=()=>new Promise(resolve=>window.connectionProbe.resolve=resolve);
    document.querySelector('.settings-connection-check button').click();
  })()`);
  try {
    await wait(`!!window.connectionProbe.resolve`);
    await evaluate(`(()=>{const field=document.querySelector('input[aria-label="CLI configuration file"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'/unverified-configuration');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await evaluate(`window.connectionProbe.resolve({ok:true,message:'stale-connection-success',cliPath:'previous-cli'})`);
    await wait(`!document.querySelector('.settings-connection-check button').disabled`);
    assert.equal(await evaluate(`document.querySelector('.settings-connection-check').textContent.includes('stale-connection-success')`), false, 'An earlier connection test marked edited configuration as verified');
  } finally {
    await evaluate(`(()=>{window.marx.settings.testConnection=window.connectionProbe.original;delete window.connectionProbe;const field=document.querySelector('input[aria-label="CLI configuration file"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  }
}

export async function verifySessionSaveIdentity(evaluate: Evaluate, wait: Wait, sessionId: string) {
  await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Workbench').click()`);
  await wait(`!!document.querySelector('.session-card')`);
  await evaluate(`document.querySelector('.session-card').click()`);
  await wait(`!!document.querySelector('[aria-label="Remediation notes"]')`);
  await evaluate(`(()=>{
    window.notesProbe={original:window.marx.workbench.updateSession};
    window.marx.workbench.updateSession=input=>{
      if(window.notesProbe.started)return window.notesProbe.original(input);
      window.notesProbe.started=true;
      return new Promise((resolve,reject)=>window.notesProbe.original(input).then(result=>{window.notesProbe.release=()=>resolve(result)},reject));
    };
    const field=document.querySelector('[aria-label="Remediation notes"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'first edit');field.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  try {
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Save notes').click()`);
    await wait(`!!window.notesProbe.release`);
    await evaluate(`(()=>{const field=document.querySelector('[aria-label="Remediation notes"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'newer edit while saving');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await evaluate(`window.notesProbe.release()`);
    await wait(`document.querySelector('main').textContent.includes('Remediation notes saved.')`);
    assert.equal(await evaluate(`document.querySelector('main').textContent.includes('Unsaved changes')`), true, 'A completed save falsely marked newer edits as saved');
    await wait(`window.marx.workbench.bootstrap().then(data=>data.sessions.find(s=>s.id===${JSON.stringify(sessionId)})?.notes==='newer edit while saving')`);
  } finally {
    await evaluate(`(()=>{window.marx.workbench.updateSession=window.notesProbe.original;delete window.notesProbe;const field=document.querySelector('[aria-label="Remediation notes"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Synthetic notes');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Save notes').click()`);
    await wait(`window.marx.workbench.bootstrap().then(data=>data.sessions.find(s=>s.id===${JSON.stringify(sessionId)})?.notes==='Synthetic notes')`);
  }
}

export async function verifySourcePreviewIdentity(evaluate: Evaluate, wait: Wait, source: string, replacement: string) {
  await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Results').click()`);
  await wait(`!!document.querySelector('select[aria-label="Scan"] option[value="s1"]')`);
  await evaluate(`(()=>{const field=document.querySelector('select[aria-label="Scan"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,'s1');field.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await wait(`!!document.querySelector('.finding-link')&&!document.querySelector('button[aria-label="Refresh findings"]').disabled`);
  await evaluate(`(()=>{window.previewProbe={picker:window.marx.dialog.selectFolder,read:window.marx.fs.readSourceFile};window.marx.dialog.selectFolder=async()=>${JSON.stringify(source)};Array.from(document.querySelectorAll('button')).find(b=>['Link repository','Change repository'].includes(b.textContent.trim())).click()})()`);
  try {
    await wait(`Array.from(document.querySelectorAll('.scan-context [title]')).some(e=>e.title===${JSON.stringify(source)})`);
    await evaluate(`document.querySelector('.finding-link').click()`);
    await wait(`!!document.querySelector('.flow-step')`);
    await evaluate(`(()=>{window.marx.fs.readSourceFile=()=>new Promise(resolve=>window.previewProbe.resolve=resolve);document.querySelector('.flow-step').click()})()`);
    await wait(`!!window.previewProbe.resolve`);
    await evaluate(`(()=>{window.marx.dialog.selectFolder=async()=>${JSON.stringify(replacement)};Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Change repository').click()})()`);
    await wait(`Array.from(document.querySelectorAll('.scan-context [title]')).some(e=>e.title===${JSON.stringify(replacement)})`);
    await evaluate(`window.previewProbe.resolve({path:'index.js',startLine:1,endLine:1,totalLines:1,lines:['stale-preview-from-previous-repository']})`);
    await Bun.sleep(100);
    assert.equal(await evaluate(`document.querySelector('.code-block')?.textContent.includes('stale-preview-from-previous-repository')??false`), false, 'A previous repository response replaced the current source preview');
  } finally {
    await evaluate(`(()=>{window.marx.dialog.selectFolder=window.previewProbe.picker;window.marx.fs.readSourceFile=window.previewProbe.read;delete window.previewProbe})()`);
  }
}

export async function verifyBatchMappingFailure(evaluate: Evaluate, wait: Wait, source: string) {
  await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Batch Scan').click()`);
  await wait(`document.querySelector('.nav-item[aria-current="page"]').textContent.trim()==='Batch Scan'&&!!document.querySelector('[data-file-drop-target]')`);
  await evaluate(`(()=>{
    window.batchProbe={picker:window.marx.dialog.selectFolder,plan:window.marx.git.plan,binding:window.marx.bindings.get,run:window.marx.scan.runBatch,calls:0};
    window.marx.dialog.selectFolder=async()=>${JSON.stringify(source)};
    window.marx.git.plan=async()=>({rootPath:${JSON.stringify(source)},projects:[{folderPath:${JSON.stringify(source)},relativePath:'.',name:'synthetic-package',dependencies:[],affected:true,reasons:[]}],sharedFiles:[],changedFiles:[],impactAvailable:false,warnings:[]});
    window.marx.bindings.get=async()=>{throw new Error('Synthetic mapping unavailable')};
    window.marx.scan.runBatch=async()=>{window.batchProbe.calls++;throw new Error('Unexpected batch submission')};
    Array.from(document.querySelectorAll('[data-file-drop-target]')).find(e=>e.getClientRects().length).click();
  })()`);
  try {
    await wait(`!!document.querySelector('select[aria-label="Project for ."]')&&!document.querySelector('main').textContent.includes('Discovering projects and dependency relationships…')`);
    assert.equal(await evaluate(`document.querySelector('select[aria-label="Project for ."]').matches(':disabled')`), true, 'A failed mapping lookup allowed choosing a new project silently');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>/^Scan [0-9]+ projects?$/.test(b.textContent.trim())).disabled`), true, 'A batch with unresolved project mappings remained submittable');
    assert.equal(await evaluate(`document.querySelector('main').textContent.includes('Synthetic mapping unavailable')`), true, 'Mapping lookup failure was hidden');
    await evaluate(`(()=>{window.marx.bindings.get=async()=>({folderPath:${JSON.stringify(source)},projectId:'p1',projectName:'synthetic-fixture'});Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Retry project mappings').click()})()`);
    await wait(`document.querySelector('select[aria-label="Project for ."]')?.value==='p1'&&!document.querySelector('select[aria-label="Project for ."]').matches(':disabled')`);
    assert.equal(await evaluate(`window.batchProbe.calls`), 0);
  } finally {
    await evaluate(`(()=>{window.marx.dialog.selectFolder=window.batchProbe.picker;window.marx.git.plan=window.batchProbe.plan;window.marx.bindings.get=window.batchProbe.binding;window.marx.scan.runBatch=window.batchProbe.run;delete window.batchProbe})()`);
  }
}

export async function verifySessionWriteOrdering(evaluate: Evaluate, wait: Wait, sessionId: string) {
  for (const rejectFirst of [false, true]) {
    await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Workbench').click()`);
    await wait(`!!document.querySelector('[aria-label="Remediation notes"]')`);
    await evaluate(`(()=>{
      window.saveProbe={original:window.marx.workbench.updateSession,calls:[]};
      window.marx.workbench.updateSession=input=>{
        window.saveProbe.calls.push(input.notes);
        if(window.saveProbe.calls.length>1)return window.saveProbe.original(input);
        return new Promise((resolve,reject)=>{
          ${rejectFirst ? "window.saveProbe.release=()=>reject(new Error('Synthetic earlier save failure'))" : 'window.saveProbe.original(input).then(result=>{window.saveProbe.release=()=>resolve(result)},reject)'};
        });
      };
      const field=document.querySelector('[aria-label="Remediation notes"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'held first draft');field.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    try {
      await wait(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Save notes').disabled`);
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Save notes').click()`);
      await wait(`!!window.saveProbe.release`);
      await evaluate(`(()=>{const field=document.querySelector('[aria-label="Remediation notes"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'queued unmount draft');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Results').click()`);
      await wait(`!document.querySelector('[aria-label="Remediation notes"]')`);
      if (!rejectFirst) {
        await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Workbench').click()`);
        await wait(`!!document.querySelector('[aria-label="Remediation notes"]')`);
        await evaluate(`(()=>{const field=document.querySelector('[aria-label="Remediation notes"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'newest remounted draft');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
        await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Save notes').click()`);
        assert.deepEqual(await evaluate(`window.saveProbe.calls`), ['held first draft'], 'Remount started a competing writer before the previous save settled');
      }
      await evaluate(`window.saveProbe.release()`);
      const expected = rejectFirst ? 'queued unmount draft' : 'newest remounted draft';
      await wait(`window.marx.workbench.bootstrap().then(data=>data.sessions.find(s=>s.id===${JSON.stringify(sessionId)})?.notes===${JSON.stringify(expected)})`);
      if (!rejectFirst) await wait(`document.querySelector('main').textContent.includes('Saved on this computer')`);
    } finally {
      await evaluate(`(()=>{window.marx.workbench.updateSession=window.saveProbe.original;delete window.saveProbe})()`);
      await evaluate(`window.marx.workbench.updateSession({id:${JSON.stringify(sessionId)},notes:'Synthetic notes'})`);
      await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Results').click()`);
    }
  }
}
