import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Activity, Check, ChevronLeft, Copy, Download, ListChecks, Play, RefreshCw, Search, Sparkles, Trash2, Wrench, X } from 'lucide-react';
import type { Finding, ResultsPage, ScanHistoryItem, ScanJobState } from '@shared/types';
import type { RemediationSession } from '@shared/workbench';
import { DecisionReview } from '../components/DecisionReview';
import { api } from '../api';
import { useApp } from '../store';
import { Banner, Empty, SeverityBadge, Spinner, StatusBadge, timeAgo, restoreControlFocus } from '../components/ui';
import { RemediationDialog, type RemediationSelection } from '../components/RemediationDialog';

const SESSION_LABELS: Record<RemediationSession['status'], string> = { open: 'Open', in_progress: 'In progress', awaiting_verification: 'Awaiting verification', verified: 'Verified absence', unresolved: 'Unresolved' };

export function WorkbenchView() {
  const { tab, setTab, error, refreshWorkbench } = useApp(useShallow((state) => ({ tab: state.workbenchTab, setTab: state.setWorkbenchTab, error: state.workbenchError, refreshWorkbench: state.refreshWorkbench })));
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  useEffect(() => { void refreshWorkbench().catch((err) => setRefreshError(err.message)); }, [refreshWorkbench]);
  return <>
    <div className="row between workspace-heading"><div><div className="page-eyebrow">Evidence and follow-through</div><h1 className="page-title">Workbench</h1><p className="page-sub">Keep remediation work and scan activity across app restarts.</p></div><button className="btn small" disabled={refreshing} onClick={async () => { setRefreshing(true); setRefreshError(null); try { await refreshWorkbench(); } catch (err) { setRefreshError(err instanceof Error ? err.message : String(err)); } finally { setRefreshing(false); } }}><RefreshCw size={14} className={refreshing ? 'spin' : ''} />Refresh</button></div>
    <div className="workbench-tabs" role="tablist" aria-label="Workbench sections" onKeyDown={event=>{
      const tabs=['sessions','activity','decisions'] as const;
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const index=tabs.indexOf(tab);const next=event.key==='Home'?tabs[0]:event.key==='End'?tabs[2]:tabs[(index+(event.key==='ArrowRight'?1:2))%3];setTab(next);document.getElementById(`${next}-tab`)?.focus();
    }}>
      {([{id:'sessions',label:'Remediations',icon:<Wrench size={15}/>},{id:'activity',label:'Activity & evidence',icon:<Activity size={15}/>},{id:'decisions',label:'Decisions',icon:<ListChecks size={15}/>} ] as const).map(item=><button key={item.id} role="tab" id={`${item.id}-tab`} tabIndex={tab===item.id?0:-1} aria-selected={tab===item.id} aria-controls={`${item.id}-panel`} className={`btn ${tab===item.id?'selected':'ghost'}`} onClick={()=>setTab(item.id)}>{item.icon}{item.label}</button>)}
    </div>
    {(error || refreshError) && <Banner kind="error">{refreshError ?? error}</Banner>}
    {tab === 'decisions' ? <div role="tabpanel" id="decisions-panel" aria-labelledby="decisions-tab"><DecisionReview /></div> : tab === 'sessions' ? <div role="tabpanel" id="sessions-panel" aria-labelledby="sessions-tab"><SessionsPanel /></div> : <div role="tabpanel" id="activity-panel" aria-labelledby="activity-tab"><ActivityPanel /></div>}
  </>;
}

function SessionsPanel() {
  const { sessions, selectedId, openSession, setView, connectionId } = useApp(useShallow((state) => ({ sessions: state.sessions, selectedId: state.selectedSessionId, openSession: state.openSession, setView: state.setView, connectionId: state.connectionId })));
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const session = sessions.find((item) => item.id === selectedId);
  const filtered = sessions.filter((item) => (status === 'all' || item.status === status) && `${item.title} ${item.projectName} ${item.changeRef}`.toLowerCase().includes(search.trim().toLowerCase()));
  if (session) return <SessionDetail key={`${connectionId}:${session.id}`} session={session} onBack={() => { useApp.setState({ selectedSessionId: null }); useApp.getState().setWorkbenchTab('sessions'); }} />;
  return <>
    <div className="toolbar"><div className="search-field"><Search size={14} /><input type="search" aria-label="Search remediations" placeholder="Search project, change, or title…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select aria-label="Remediation status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{Object.entries(SESSION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button className="btn primary small" onClick={() => setView('results')}><ListChecks size={14} />Choose findings to remediate</button></div>
    {!sessions.length ? <Empty icon={<Wrench size={34} strokeWidth={1.4} />} title="Start with evidence" hint="In Results, choose findings or a fix group, open Fix with AI, and select Track remediation. Your baseline, handoff, notes, and verification stay together here." action={<button className="btn" onClick={() => setView('results')}>Open Results</button>} /> : !filtered.length ? <Empty icon={<Search size={28} />} title="No matching remediations" hint="Try another project, title, or status." /> : <div className="session-list">{filtered.map((item) => <button className="session-card" key={item.id} onClick={() => openSession(item.id)}><div className="row between"><strong>{item.title}</strong><span className={`session-status ${item.status}`}>{SESSION_LABELS[item.status]}</span></div><div className="row"><span>{item.projectName}</span><span className="faint">{item.findingIds.length} findings</span><span className="faint">Updated {timeAgo(new Date(item.updatedAt).toISOString())}</span></div>{item.changeRef && <div className="mono faint">{item.changeRef}</div>}</button>)}</div>}
  </>;
}

function SessionDetail({ session, onBack }: { session: RemediationSession; onBack: () => void }) {
  const { cachedScans, jobs, historyVersion, refreshWorkbench, setSelectedScan, setView, applyEvent } = useApp(useShallow((state) => ({ cachedScans: state.cachedScans, jobs: state.jobs, historyVersion: state.historyVersion, refreshWorkbench: state.refreshWorkbench, setSelectedScan: state.setSelectedScan, setView: state.setView, applyEvent: state.applyEvent })));
  const [draft, setDraft] = useState({ title: session.title, notes: session.notes, changeRef: session.changeRef, checks: session.checks, status: '' as '' | 'open' | 'in_progress' | 'awaiting_verification' });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationFeedback, setVerificationFeedback] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [baseline, setBaseline] = useState<ResultsPage | null>(null);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyOffset = useRef(0);
  const [verificationId, setVerificationId] = useState(session.verification?.scanId ?? '');
  const [remediation, setRemediation] = useState<RemediationSelection | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const saveVersion = useRef(0);
  const mounted = useRef(true);
  const [showHandoff, setShowHandoff] = useState(false);
  const verificationJob = jobs.find((job) => job.id === session.verificationJobId);
  const verificationRunning = Boolean(verificationJob && !verificationJob.finishedAt && ['Queued', 'Running'].includes(verificationJob.status));
  const selectedFindings = useMemo(() => {
    const ids = new Set(session.findingIds);
    return baseline?.findings.filter((finding) => ids.has(finding.id)) ?? [];
  }, [baseline, session.findingIds]);
  const candidates = useMemo(() => [...new Map([...cachedScans, ...history].map((scan) => [scan.id, scan])).values()].filter((scan) => scan.projectId === session.projectId && scan.id !== session.baselineScanId && scan.status === 'Completed' && (!baseline?.scan?.createdAt || Date.parse(scan.createdAt) > Date.parse(baseline.scan.createdAt))).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [cachedScans, history, session.projectId, session.baselineScanId, baseline?.scan?.createdAt]);
  useEffect(() => {
    let current = true;
    void api.workbench.evidence(session.id).then((bundle) => { if (current) setBaseline(bundle.baseline); }).catch((err) => { if (current) setError(`Baseline evidence could not be loaded: ${err.message}`); });
    return () => { current = false; };
  }, [session.id]);
  useEffect(() => {
    let current = true;
    setHistoryLoading(true);
    void api.scan.history({ projectId: session.projectId, limit: 100, offset: 0 }).then((items) => { if (current) { setHistory(items); historyOffset.current = items.length; } }).catch((err) => { if (current) setVerificationFeedback({ kind: 'error', text: `Remote history could not be refreshed: ${err.message}` }); }).finally(() => { if (current) setHistoryLoading(false); });
    return () => { current = false; };
  }, [session.projectId, historyVersion]);
  useEffect(() => { if (verificationJob?.scanId) setVerificationId(verificationJob.scanId); }, [verificationJob?.scanId]);
  draftRef.current = draft;
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirty || !draft.title.trim()) return;
    const version = ++saveVersion.current;
    const timer = setTimeout(() => {
      void api.workbench.updateSession({ id: session.id, title: draft.title.trim(), notes: draft.notes, changeRef: draft.changeRef, checks: draft.checks, ...(draft.status ? { status: draft.status } : {}) }).then(() => {
        if (mounted.current && version === saveVersion.current) { dirtyRef.current = false; setDirty(false); setDraft((value) => ({ ...value, status: '' })); void refreshWorkbench().catch(() => undefined); }
      }).catch((err) => { if (mounted.current) setError(`Could not save notes: ${err.message}`); });
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, dirty, session.id, refreshWorkbench]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const pending = draftRef.current;
      if (dirtyRef.current && pending.title.trim()) void api.workbench.updateSession({ id: session.id, title: pending.title.trim(), notes: pending.notes, changeRef: pending.changeRef, checks: pending.checks, ...(pending.status ? { status: pending.status } : {}) }).catch(() => undefined);
    };
  }, [session.id]);
  const change = (patch: Partial<typeof draft>) => { saveVersion.current++; dirtyRef.current = true; setDraft((value) => ({ ...value, ...patch })); setDirty(true); };
  const save = async () => {
    if (!draft.title.trim()) throw new Error('Give the remediation a title.');
    await api.workbench.updateSession({ id: session.id, title: draft.title.trim(), notes: draft.notes, changeRef: draft.changeRef, checks: draft.checks, ...(draft.status ? { status: draft.status } : {}) });
    saveVersion.current++;
    dirtyRef.current = false;
    setDirty(false);
    setDraft((value) => ({ ...value, status: '' }));
    await refreshWorkbench();
  };
  const run = async (name: string, action: () => Promise<void>, origin?: HTMLElement) => {
    if (busy) return;
    const verificationAction = ['verify', 'history', 'run'].includes(name);
    if (verificationAction) setVerificationFeedback(null);
    setBusy(name); setError(null); setNotice(null);
    try { await action(); } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (verificationAction) setVerificationFeedback({ kind: 'error', text: name === 'verify' ? `Comparison was not updated. ${message}` : message });
      else setError(message);
    } finally { setBusy(null); if (origin) restoreControlFocus(origin); }
  };
  const openScan = (scanId: string) => { setSelectedScan(scanId, session.folderPath ?? null); setView('results'); };
  const prepareHandoff = () => {
    if (!baseline || !selectedFindings.length) return;
    setRemediation({ scopes: [{ id: 'session', name: session.title, findings: selectedFindings }], initialScope: 'session', initialSeverities: [...new Set(selectedFindings.map((finding) => finding.severity))], context: { scanId: session.baselineScanId, sessionId: session.id, projectName: session.projectName, branch: baseline.scan?.branch, sourceProvenance: baseline.provenance, workspaceName: session.folderPath?.split(/[\\/]/).filter(Boolean).pop(), loadedCount: baseline.findings.length, totalCount: baseline.totalCount, truncated: Boolean(baseline.truncated), demo: false } });
  };
  return <>
    <div className="row between session-heading"><button className="btn ghost small" onClick={() => void run('back', async () => { if (dirty) await save(); onBack(); })}><ChevronLeft size={14} />All remediations</button><span className={`session-status ${session.status}`}>{SESSION_LABELS[session.status]}</span></div>
    <div className="session-context"><strong>{session.projectName}</strong><span className="faint">{session.findingIds.length} tracked findings</span><button className="btn ghost small" onClick={() => openScan(session.baselineScanId)}>Baseline {session.baselineScanId.slice(0, 8)}</button></div>
    {error && <Banner kind="error">{error}</Banner>}{notice && <Banner kind="ok">{notice}</Banner>}
    <div className="session-editor">
      <div className="card"><label className="field">Remediation title<input aria-label="Remediation title" value={draft.title} maxLength={200} onChange={(event) => change({ title: event.target.value })} /></label><div className="grid-2"><label className="field">Change reference<input aria-label="Change reference" placeholder="Commit, branch, pull request, or patch" value={draft.changeRef} onChange={(event) => change({ changeRef: event.target.value })} /></label><label className="field">Work status<select aria-label="Work status" value={draft.status} onChange={(event) => change({ status: event.target.value as typeof draft.status })}><option value="">Keep current: {SESSION_LABELS[session.status]}</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="awaiting_verification">Awaiting verification</option></select></label></div><label className="field">Investigation and change notes<textarea aria-label="Remediation notes" rows={4} value={draft.notes} onChange={(event) => change({ notes: event.target.value })} placeholder="Root cause, intended change, and remaining questions" /></label><label className="field">Local validation<textarea aria-label="Local validation" rows={3} value={draft.checks} onChange={(event) => change({ checks: event.target.value })} placeholder="Commands run, outcomes, and anything not checked" /></label><div className="row"><button className="btn primary small" disabled={Boolean(busy) || !dirty} onClick={() => void run('save', async () => { await save(); setNotice('Remediation notes saved.'); })}>{busy === 'save' ? <Spinner size={13} /> : <Check size={13} />}Save notes</button><span className="faint" role="status">{dirty ? 'Unsaved changes' : 'Saved on this computer'}</span></div></div>
      <div className="card session-actions"><h2 className="section-heading">Handoff</h2><p className="field-help">Review the exact findings and source context before giving your coding assistant the task.</p><button className="btn" disabled={!selectedFindings.length || Boolean(busy)} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); prepareHandoff(); }}><Sparkles size={14} />Build remediation prompt</button>{session.handoff && <><button className="btn small" disabled={Boolean(busy)} onClick={() => void run('copy', async () => { await api.remediation.copy(session.handoff!); setNotice('Saved handoff copied.'); })}><Copy size={13} />Copy saved handoff</button><button className="btn ghost small" onClick={() => setShowHandoff((value) => !value)}>{showHandoff ? 'Hide saved handoff' : 'Inspect saved handoff'}</button></>}<h2 className="section-heading">Evidence</h2><button className="btn small" disabled={Boolean(busy)} onClick={(event) => void run('export', async () => { if (dirty) await save(); const destination = await api.workbench.exportSession(session.id); if (destination) setNotice(`Evidence exported to ${destination}`); }, event.currentTarget)}><Download size={13} />Export evidence bundle</button><button className="btn ghost small danger-text" disabled={Boolean(busy)} onClick={() => setDeletePending(true)}><Trash2 size={13} />Delete session</button></div>
    </div>
    {showHandoff && session.handoff && <textarea className="saved-handoff" aria-label="Saved remediation handoff" value={session.handoff} readOnly spellCheck={false} />}
    {deletePending && <Banner kind="warn" action={<div className="row"><button className="btn small" onClick={() => setDeletePending(false)}>Keep session</button><button className="btn danger small" disabled={Boolean(busy)} onClick={() => void run('delete', async () => { await api.workbench.deleteSession(session.id); await refreshWorkbench(); onBack(); })}>Delete local session</button></div>}>Delete this local session and its notes? This does not change remote Checkmarx findings or source files.</Banner>}
    <div className="card verification-card"><h2 className="section-heading">Verify the change</h2><p className="field-help">Use a completed scan of this project or explicitly run a new scan. Comparison checks coverage and source provenance; missing evidence stays inconclusive.</p>{verificationFeedback && <Banner kind={verificationFeedback.kind}>{verificationFeedback.text}</Banner>}<div className="verification-controls"><label className="field">Completed verification scan<select aria-label="Verification scan" value={verificationId} onChange={(event) => setVerificationId(event.target.value)}><option value="">Choose a later scan…</option>{verificationId && !candidates.some((scan) => scan.id === verificationId) && <option value={verificationId}>{verificationId.slice(0, 12)} · previous verification</option>}{candidates.map((scan) => <option key={scan.id} value={scan.id}>{scan.branch} · {new Date(scan.createdAt).toLocaleString()} · {scan.id.slice(0, 8)}</option>)}</select></label><button className="btn small" disabled={Boolean(busy) || !verificationId} onClick={() => void run('verify', async () => { if (dirty) await save(); await api.workbench.verifySession({ id: session.id, scanId: verificationId }); await refreshWorkbench(); })}>{busy === 'verify' ? <Spinner size={14} /> : <Check size={14} />}Compare evidence</button><button className="btn ghost small" disabled={Boolean(busy) || historyLoading} onClick={() => void run('history', async () => { setHistoryLoading(true); try { const more = await api.scan.history({ projectId: session.projectId, offset: historyOffset.current, limit: 100 }); historyOffset.current += more.length; setHistory((current) => [...new Map([...current, ...more].map((scan) => [scan.id, scan])).values()]); if (!more.length) setVerificationFeedback({ kind: 'ok', text: 'No older scans were returned for this project.' }); } finally { setHistoryLoading(false); } })}>{historyLoading ? 'Loading scans…' : 'Load more scans'}</button></div><div className="row"><button className="btn primary small" disabled={Boolean(busy) || verificationRunning || !session.folderPath} onClick={() => void run('run', async () => { if (dirty) await save(); const job = await api.workbench.runVerification(session.id); if (!useApp.getState().jobs.some((current) => current.id === job.id)) applyEvent({ kind: 'job-updated', job }); await refreshWorkbench(); setVerificationFeedback({ kind: 'ok', text: 'Verification scan started. Its evidence will be linked to this remediation.' }); })}>{busy === 'run' ? <Spinner size={14} /> : <Play size={14} />}Run verification scan</button><span className="field-help">{session.folderPath ? 'Uploads the linked repository through your configured Checkmarx CLI.' : 'Link the repository in Results when creating a session to run a verification scan here.'}</span></div>{verificationJob && <div className="verification-job"><StatusBadge status={verificationJob.status} /><span>{verificationJob.progress.detail ?? verificationJob.progress.phase}</span>{verificationJob.scanId && <button className="btn ghost small" onClick={() => openScan(verificationJob.scanId!)}>Open scan</button>}</div>}{session.verification && <VerificationSummary session={session} onOpen={() => openScan(session.verification!.scanId)} />}</div>
    <details className="session-evidence"><summary>Tracked findings ({session.findingIds.length})</summary>{baseline && selectedFindings.length !== session.findingIds.length && <Banner kind="warn">Only {selectedFindings.length} of {session.findingIds.length} tracked findings are available in this evidence snapshot.</Banner>}<div className="bounded-list">{selectedFindings.map((finding) => <div className="session-finding" key={finding.id}><SeverityBadge severity={finding.severity} /><div><strong>{finding.title}</strong><div className="mono faint">{finding.where}</div><div className="faint">{finding.id}</div></div></div>)}</div>{!baseline && <p className="field-help">Loading baseline evidence…</p>}</details>
    {remediation && <RemediationDialog selection={remediation} onClose={() => setRemediation(null)} trackLabel="Save handoff to session" onTrack={async ({ findingIds, handoff }) => { const ids = new Set(findingIds); if (session.findingIds.some((id) => !ids.has(id))) throw new Error('Include every tracked finding when saving this session handoff. Create a smaller session from Results for a narrower task.'); if (dirty) await save(); await api.workbench.updateSession({ id: session.id, handoff }); await refreshWorkbench(); }} />}
  </>;
}

function VerificationSummary({ session, onOpen }: { session: RemediationSession; onOpen: () => void }) {
  const record = session.verification!;
  return <div className="verification-summary"><Banner kind={session.status === 'verified' ? 'ok' : record.comparison.verdict === 'attention' ? 'error' : 'warn'}><strong>{session.status === 'verified' ? 'Tracked findings are absent under comparable scan coverage.' : record.comparison.headline}</strong>{record.comparison.reasons.length > 0 && <ul>{record.comparison.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}</Banner><div className="row comparison-counts"><span>{record.remainingIds.length} tracked findings remain</span><span>{record.absentIds.length} tracked findings absent</span><span>{record.newIds.length} new findings</span></div><div className="row"><span className="faint">Checked {new Date(record.checkedAt).toLocaleString()}</span><button className="btn ghost small" onClick={onOpen}>Inspect verification scan</button></div></div>;
}

function ActivityPanel() {
  const { jobs, cachedScans, logs, refreshWorkbench, setSelectedScan, setView, applyEvent } = useApp(useShallow((state) => ({ jobs: state.jobs, cachedScans: state.cachedScans, logs: state.logs, refreshWorkbench: state.refreshWorkbench, setSelectedScan: state.setSelectedScan, setView: state.setView, applyEvent: state.applyEvent })));
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [logSearch, setLogSearch] = useState('');
  const [savedLogs, setSavedLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCache, setShowCache] = useState(false);
  const [deleteScan, setDeleteScan] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [prunePending, setPrunePending] = useState(false);
  const [visibleJobs, setVisibleJobs] = useState(100);
  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const running = selectedJob && !selectedJob.finishedAt && ['Queued', 'Running'].includes(selectedJob.status);
  const currentLogs = running && logs[selectedJobId ?? '']?.length ? logs[selectedJobId!] : savedLogs;
  const filteredLogs = currentLogs.filter((line) => line.toLowerCase().includes(logSearch.toLowerCase()));
  const filteredJobs = jobs.filter((job) => (status === 'all' || job.status === status) && `${job.projectName} ${job.branch} ${job.scanId ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => {
    let current = true;
    setSavedLogs([]); setLogSearch('');
    if (!selectedJobId) return;
    void api.workbench.logs(selectedJobId).then((lines) => { if (current) setSavedLogs(lines); }).catch((err) => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [selectedJobId, selectedJob?.finishedAt]);
  const run = async (name: string, action: () => Promise<void>, origin?: HTMLElement) => {
    if (busy) return;
    setBusy(name); setError(null); setNotice(null);
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(null); if (origin) restoreControlFocus(origin); }
  };
  const openScan = (scanId: string, folder?: string) => { setSelectedScan(scanId, folder ?? null); setView('results'); };
  return <>
    <div className="toolbar"><div className="search-field"><Search size={14} /><input type="search" aria-label="Search activity" placeholder="Search project, branch, scan…" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleJobs(100); }} /></div><select aria-label="Activity status" value={status} onChange={(event) => { setStatus(event.target.value); setVisibleJobs(100); }}><option value="all">All statuses</option>{[...new Set(jobs.map((job) => job.status))].map((value) => <option key={value} value={value}>{value}</option>)}</select><button className="btn small" onClick={() => setShowCache((value) => !value)}>{showCache ? 'Hide saved evidence' : `Saved evidence (${cachedScans.length})`}</button></div>
    {error && <Banner kind="error">{error}</Banner>}{notice && <Banner kind="ok">{notice}</Banner>}
    {showCache && <div className="card cache-panel"><h2 className="section-heading">Saved evidence</h2><p className="field-help">These scan snapshots are stored on this computer. Removing a snapshot does not delete the remote scan.</p><div className="bounded-list">{cachedScans.map((scan) => <div className="cache-row" key={scan.id}><div><strong>{scan.projectName}</strong><div className="faint">{scan.branch} · {timeAgo(scan.createdAt)} · {scan.id.slice(0, 8)}</div></div><button className="btn ghost small" onClick={() => openScan(scan.id)}>Open</button><button className="btn ghost small" aria-label={`Remove saved evidence ${scan.id}`} onClick={() => setDeleteScan(scan.id)}><Trash2 size={13} /></button></div>)}</div><div className="row retention-controls"><label className="field">Retention window<select aria-label="Evidence retention window" value={retentionDays} onChange={(event) => setRetentionDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label><button className="btn small" onClick={() => setPrunePending(true)}>Remove older saved evidence</button></div>{deleteScan && <Banner kind="warn" action={<div className="row"><button className="btn small" onClick={() => setDeleteScan(null)}>Keep evidence</button><button className="btn danger small" disabled={Boolean(busy)} onClick={() => void run('remove', async () => { await api.workbench.deleteSnapshot(deleteScan); setDeleteScan(null); await refreshWorkbench(); })}>Remove local snapshot</button></div>}>Remove saved scan {deleteScan.slice(0, 12)} from this computer?</Banner>}{prunePending && <Banner kind="warn" action={<div className="row"><button className="btn small" onClick={() => setPrunePending(false)}>Cancel cleanup</button><button className="btn danger small" disabled={Boolean(busy)} onClick={() => void run('prune', async () => { await api.workbench.prune(retentionDays); setPrunePending(false); await refreshWorkbench(); setNotice('Saved evidence cleanup completed.'); })}>Clean up local evidence</button></div>}>Remove eligible evidence older than {retentionDays} days across all local connections? Evidence referenced by remediation sessions is retained. Remote scans and source files remain unchanged.</Banner>}</div>}
    {!jobs.length ? <Empty icon={<Activity size={34} strokeWidth={1.4} />} title="Your scan activity will appear here" hint="Jobs and their diagnostics are retained so you can reconnect to remote scans after interruptions." action={<button className="btn" onClick={() => setView('scan')}>Start a scan</button>} /> : <div className={`activity-layout ${selectedJob ? 'has-job' : ''}`}><div className="activity-jobs">{filteredJobs.slice(0, visibleJobs).map((job) => <button className={`activity-job ${job.id === selectedJobId ? 'selected' : ''}`} key={job.id} onClick={() => setSelectedJobId(job.id)}><div className="row between"><strong>{job.projectName}</strong><StatusBadge status={job.status} /></div><div className="faint">{job.branch} · {timeAgo(new Date(job.startedAt).toISOString())}</div><div className="field-help">{job.progress.detail ?? job.progress.phase}</div></button>)}{filteredJobs.length > visibleJobs && <button className="btn ghost small" onClick={() => setVisibleJobs((value) => value + 100)}>Show more jobs</button>}{!filteredJobs.length && <div className="empty">No jobs match these filters.</div>}</div>{selectedJob && <div className="card job-detail"><div className="row between"><h2 className="section-heading">{selectedJob.projectName}</h2><button className="btn ghost small" aria-label="Close job details" onClick={() => setSelectedJobId(null)}><X size={15} /></button></div><dl className="kv"><dt>Remote status</dt><dd><StatusBadge status={selectedJob.status} /></dd><dt>Local phase</dt><dd>{selectedJob.progress.phase}</dd><dt>Scan ID</dt><dd className="mono">{selectedJob.scanId ?? 'Not captured'}</dd><dt>Repository</dt><dd className="mono">{selectedJob.folderPath}</dd><dt>Started</dt><dd>{new Date(selectedJob.startedAt).toLocaleString()}</dd>{selectedJob.finishedAt && <><dt>Local activity settled</dt><dd>{new Date(selectedJob.finishedAt).toLocaleString()}</dd></>}</dl>{selectedJob.error && <Banner kind="warn">{selectedJob.error}</Banner>}{!selectedJob.scanId && <p className="field-help">If submission was interrupted, check Checkmarx One before submitting again. An unknown local outcome does not establish that no remote scan exists.</p>}<div className="row job-actions"><button className="btn small" disabled={Boolean(busy)} onClick={() => void run('reconcile', async () => { const job = await api.workbench.reconcileJob(selectedJob.id); applyEvent({ kind: 'job-updated', job }); await refreshWorkbench(); setSavedLogs(await api.workbench.logs(selectedJob.id)); })}><RefreshCw size={13} />Reconcile remote status</button>{selectedJob.scanId && <button className="btn ghost small" onClick={() => openScan(selectedJob.scanId!, selectedJob.folderPath)}>Open results</button>}{running && <button className="btn danger small" disabled={Boolean(busy)} onClick={() => void run('cancel', async () => { await api.scan.cancelJob(selectedJob); await refreshWorkbench(); })}>Request cancellation</button>}</div><div className="log-heading"><h3>Diagnostics</h3><div className="row"><button className="btn ghost small" disabled={Boolean(busy)} onClick={() => void run('logs', async () => { setSavedLogs(await api.workbench.logs(selectedJob.id)); })}>Refresh logs</button><button className="btn ghost small" disabled={!currentLogs.length || Boolean(busy)} onClick={(event) => void run('export-logs', async () => { const path = await api.remediation.save({ text: `# Marx diagnostics\n\nProject: ${selectedJob.projectName}\nScan: ${selectedJob.scanId ?? 'unknown'}\n\n${currentLogs.join('\n')}\n`, suggestedName: `${selectedJob.projectName}-diagnostics` }); if (path) setNotice(`Diagnostics saved to ${path}`); }, event.currentTarget)}><Download size={13} />Save</button></div></div><input type="search" aria-label="Search diagnostics" placeholder="Filter diagnostic output…" value={logSearch} onChange={(event) => setLogSearch(event.target.value)} /><pre className="activity-log" tabIndex={0} aria-label="Job diagnostics">{filteredLogs.slice(-1000).join('\n') || 'No diagnostic output in this scope.'}</pre><p className="field-help">{running ? 'Live tail' : 'Saved diagnostics'} · Showing {Math.min(1000, filteredLogs.length)} of {filteredLogs.length} matching lines. Exports contain the loaded log set.</p></div>}</div>}
  </>;
}
