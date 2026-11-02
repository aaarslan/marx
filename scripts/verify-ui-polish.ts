import assert from 'node:assert/strict';

type Evaluate = (expression: string) => Promise<any>;
type Wait = (expression: string) => Promise<void>;

export async function verifyIntelligenceLayout(evaluate: Evaluate, wait: Wait) {
  await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='CVE intelligence').click()`);
  await wait(`document.querySelector('.intel-count')?.textContent==='0 / 200'`);
  const layout = await evaluate(`(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};
    const watch=document.querySelector('.intel-watch');const details=document.querySelector('.intel-lookup-result');const main=document.querySelector('main');
    return {width:innerWidth,watch:rect(watch),details:rect(details),refresh:rect(watch.querySelector('.intel-refresh')),empty:rect(watch.querySelector('.empty')),overflow:main.scrollWidth-main.clientWidth};
  })()`);
  if (layout.width > 1100) {
    assert.ok(Math.abs(layout.watch.top-layout.details.top)<=1, 'Intelligence panels do not share a top edge');
    assert.ok(Math.abs(layout.watch.bottom-layout.details.bottom)<=1, 'Intelligence panels do not share a bottom edge');
  } else {
    const stackedGap = Math.round((layout.details.top-layout.watch.bottom)*64)/64;
    assert.ok(stackedGap>=16, 'Minimum-size intelligence panels did not stack: '+JSON.stringify(layout));
  }
  assert.ok(layout.empty.top-layout.refresh.bottom>=16, 'Refresh action is cramped against watchlist content');
  assert.ok(layout.overflow<=1, 'Intelligence layout overflows the native content area');
  await evaluate(`(()=>{window.uiWatchProbe={original:window.marx.intelligence.watchlist};window.marx.intelligence.watchlist=()=>new Promise(resolve=>window.uiWatchProbe.resolve=resolve);Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Scan').click()})()`);
  try {
    await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='CVE intelligence').click()`);
    await wait(`!!window.uiWatchProbe.resolve&&!!document.querySelector('.intel-watch .loading-state')`);
    assert.equal(await evaluate(`document.querySelector('.intel-watch .loading-state').getAttribute('role')`),'status');
    assert.equal(await evaluate(`!!document.querySelector('.loading-state .spin')`),false,'Content loading fell back to an inline spinner');
    assert.equal(await evaluate(`document.querySelector('.intel-history').textContent.includes('No observed changes yet')`),false,'Unread history was presented as empty');
    await evaluate(`window.uiWatchProbe.original().then(data=>window.uiWatchProbe.resolve(data))`);
    await wait(`!document.querySelector('.intel-watch .loading-state')`);
  } finally {
    await evaluate(`(()=>{window.marx.intelligence.watchlist=window.uiWatchProbe.original;delete window.uiWatchProbe})()`);
  }
  await evaluate(`(()=>{window.uiWatchFailure=window.marx.intelligence.watchlist;window.marx.intelligence.watchlist=async()=>{throw new Error('Synthetic watchlist read failure')};Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Scan').click()})()`);
  try {
    await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='CVE intelligence').click()`);
    await wait(`!!document.querySelector('.intel-watch .intel-unavailable button')`);
    await evaluate(`window.marx.intelligence.watchlist=window.uiWatchFailure`);
    await evaluate(`document.querySelector('.intel-watch .intel-unavailable button').click()`);
    await wait(`!document.querySelector('.intel-watch .intel-unavailable')&&document.querySelector('.intel-count').textContent==='0 / 200'`);
    assert.equal(await evaluate(`document.activeElement===document.querySelector('.intel-watch')`),true,'Watchlist recovery lost keyboard focus');
  } finally {
    await evaluate(`(()=>{window.marx.intelligence.watchlist=window.uiWatchFailure;delete window.uiWatchFailure})()`);
  }
  await evaluate(`(()=>{window.uiCacheProbe=window.marx.intelligence.get;window.marx.intelligence.get=async()=>{throw new Error('Synthetic cached-context read failure')};const field=document.querySelector('#cve-lookup');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'CVE-2021-44228');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  try {
    await evaluate(`document.querySelector('.intel-lookup').requestSubmit()`);
    await wait(`document.querySelector('.intel-lookup-result').textContent.includes('Cached intelligence could not be read.')`);
    assert.equal(await evaluate(`document.querySelector('.intel-lookup-result').textContent.includes('No cached intelligence.')`),false,'A cache read failure was presented as missing evidence');
    await evaluate(`window.marx.intelligence.get=window.uiCacheProbe`);
    await evaluate(`document.querySelector('.intel-lookup-result .intel-unavailable button').click()`);
    await wait(`!document.querySelector('.intel-lookup-result .intel-unavailable')&&!document.querySelector('.intel-lookup-result .loading-state')`);
    assert.equal(await evaluate(`document.activeElement===document.querySelector('.intel-lookup-result')`),true,'Cache recovery lost keyboard focus');
  } finally {
    await evaluate(`(()=>{window.marx.intelligence.get=window.uiCacheProbe;delete window.uiCacheProbe})()`);
  }
}

export async function verifyBaselineRecovery(evaluate: Evaluate, wait: Wait) {
  await evaluate(`(()=>{window.uiEvidenceProbe=window.marx.workbench.evidence;window.marx.workbench.evidence=async()=>{throw new Error('Synthetic baseline read failure')};Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Workbench').click()})()`);
  try {
    await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Retry baseline evidence')`);
    assert.equal(await evaluate(`document.querySelector('.session-evidence').textContent.includes('Loading baseline evidence')`),false,'Failed baseline evidence kept a permanent loading state');
    await evaluate(`window.marx.workbench.evidence=window.uiEvidenceProbe`);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Retry baseline evidence').click()`);
    await wait(`!!document.querySelector('.session-evidence .session-finding')`);
    assert.equal(await evaluate(`document.activeElement===document.querySelector('.session-evidence')&&document.querySelector('.session-evidence').open`),true,'Baseline recovery lost focus or left its content collapsed');
    assert.equal(await evaluate(`document.querySelector('main').textContent.includes('Synthetic baseline read failure')`),false,'Recovered evidence retained its failure state');
  } finally {
    await evaluate(`(()=>{window.marx.workbench.evidence=window.uiEvidenceProbe;delete window.uiEvidenceProbe;Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Results').click()})()`);
  }
}

export async function verifyIntelligenceFilterReset(evaluate: Evaluate, wait: Wait) {
  await wait(`!!document.querySelector('select[aria-label="Intelligence filter"]')`);
  await evaluate(`(()=>{const field=document.querySelector('select[aria-label="Intelligence filter"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,'epss');field.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Clear filters')`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Clear filters').click()`);
  await wait(`document.querySelector('select[aria-label="Intelligence filter"]').value==='all'&&document.querySelectorAll('.finding-link').length===2`);
}

export async function verifyResultsLoading(evaluate: Evaluate, wait: Wait) {
  const verifyEmptyTable = async (columns: number, scenario: string) => {
    console.log(`Checking empty Results table: ${scenario}`);
    await wait(`!!document.querySelector('.results-table .empty')`);
    const table = await evaluate(`(()=>{const table=document.querySelector('.results-table table');const headers=Array.from(table.querySelectorAll('th'));return {columns:headers.length,span:table.querySelector('tbody td').colSpan,headerRight:headers.at(-1).getBoundingClientRect().right,tableRight:table.getBoundingClientRect().right}})()`);
    assert.equal(table.columns,columns,'Unexpected visible Results columns');
    assert.equal(table.span,columns,'Empty results introduced columns without headers');
    assert.ok(Math.abs(table.headerRight-table.tableRight)<=1,`Empty results header does not span the table: ${JSON.stringify(table)}`);
  };
  await evaluate(`Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='Results').click()`);
  await wait(`!!document.querySelector('select[aria-label="Scan"] option[value="large-paging"]')`);
  await evaluate(`(()=>{const field=document.querySelector('select[aria-label="Scan"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,'s1');field.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await wait(`!!document.querySelector('.results-table table')&&!document.querySelector('.results-workspace .loading-state')`);
  await evaluate(`(()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Clear filters')?.click();Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='All findings')?.click()})()`);
  await wait(`document.querySelectorAll('.finding-link').length>0`);
  await evaluate(`(()=>{const field=document.querySelector('input[aria-label="Search findings"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'synthetic-no-matching-findings');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await verifyEmptyTable(5, 'filtered findings');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Clear filters').click()`);
  await wait(`document.querySelectorAll('.finding-link').length>0`);
  await evaluate(`document.querySelector('.finding-link').click()`);
  await wait(`!!document.querySelector('.investigation-detail .finding-heading')`);
  await evaluate(`(()=>{const field=document.querySelector('input[aria-label="Search findings"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'synthetic-no-matching-findings');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await verifyEmptyTable(4, 'filtered findings with details');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Clear filters').click()`);
  await wait(`document.querySelectorAll('.finding-link').length>0`);
  await wait(`!!document.querySelector('select[aria-label="Scan"] option[value="s2"]')`);
  await evaluate(`(()=>{const field=document.querySelector('select[aria-label="Scan"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,'s2');field.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await verifyEmptyTable(5, 'empty scan');
  await wait(`!!document.querySelector('select[aria-label="Baseline scan"] option[value="s1"]')`);
  await evaluate(`(()=>{const field=document.querySelector('select[aria-label="Baseline scan"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,'s1');field.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await wait(`!!document.querySelector('.results-table .change-cell')`);
  await verifyEmptyTable(6, 'empty scan with comparison');
  await evaluate(`(()=>{const field=document.querySelector('select[aria-label="Scan"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,'s1');field.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await wait(`document.querySelectorAll('.finding-link').length>0`);
  await evaluate(`(()=>{
    window.uiResultsProbe={original:window.marx.results.get};
    window.marx.results.get=(...args)=>new Promise((resolve,reject)=>window.uiResultsProbe.original(...args).then(data=>{window.uiResultsProbe.release=()=>resolve(data)},reject));
    const field=document.querySelector('select[aria-label="Scan"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(field,'large-paging');field.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  try {
    await wait(`!!window.uiResultsProbe.release&&document.querySelector('.results-workspace .loading-state')?.textContent.includes('Loading findings')`);
    assert.equal(await evaluate(`!!document.querySelector('.results-workspace .loading-state .spin')`),false,'Findings load used an inline spinner');
    assert.equal(await evaluate(`document.querySelector('.results-workspace .loading-state').getAttribute('role')`),'status');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('.nav-item')).some(b=>b.disabled)`),false,'Loading findings blocked navigation');
    await evaluate(`window.uiResultsProbe.release()`);
    await wait(`document.querySelectorAll('.finding-link').length===100&&!document.querySelector('.results-workspace .loading-state')`);
  } finally {
    await evaluate(`(()=>{window.marx.results.get=window.uiResultsProbe.original;delete window.uiResultsProbe})()`);
  }
}

export async function verifyWatchRemovalFocus(evaluate: Evaluate, wait: Wait) {
  await evaluate(`(async()=>{
    const original=window.marx.intelligence.watchlist;
    window.uiFocusProbe={original,before:await original(),responses:[]};
    window.marx.intelligence.watchlist=()=>new Promise(resolve=>window.uiFocusProbe.responses.push(resolve));
    const button=document.querySelector('button[aria-label="Stop watching CVE-2024-1234"]');button.focus();button.click();
  })()`);
  try {
    await wait(`window.uiFocusProbe.responses.length>=1`);
    await evaluate(`window.dispatchEvent(new Event('marx-intelligence-changed'))`);
    await wait(`window.uiFocusProbe.responses.length>=2`);
    await evaluate(`window.uiFocusProbe.responses[0](window.uiFocusProbe.before)`);
    await wait(`document.querySelectorAll('.intel-watch-row button:disabled').length===0`);
    await evaluate(`window.uiFocusProbe.original().then(data=>window.uiFocusProbe.responses.forEach(resolve=>resolve(data)))`);
    await wait(`document.querySelectorAll('.intel-watch-row').length===1&&document.activeElement===document.querySelector('.intel-watch-row > button:first-child')`);
  } finally {
    await evaluate(`(()=>{window.marx.intelligence.watchlist=window.uiFocusProbe.original;delete window.uiFocusProbe})()`);
  }
}
