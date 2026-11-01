import { useShallow } from 'zustand/react/shallow';
import { hasScanCredentials } from '@shared/types';
import { folderName } from '@shared/path';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, FileCode2, ListChecks, RefreshCw, Sparkles, Search, FolderOpen, X, Layers, Check } from 'lucide-react';
import type { Finding, ResultState, ResultsPage, ScanHistoryItem, Severity } from '@shared/types';
import type { ScanComparison, WorkspaceState } from '@shared/workbench';
import { RESULT_STATES, emptySeverityCounts } from '@shared/types';
import { SEVERITIES, SEVERITY_COLOR, SEVERITY_LABEL } from '@shared/severity';
import { baselineCandidates } from '@shared/baseline';
import { groupFindings } from '@shared/remediationGroups';
import { api } from '../api';
import { useApp } from '../store';
import { DEMO_RESULTS } from '../demo';
import { RemediationDialog, type RemediationSelection } from '../components/RemediationDialog';
import { FindingIntelligence, IntelligenceRefresh, useIntelligence } from '../components/IntelligencePanel';
import { findingCVE, intelligenceLabel, matchesIntelligence } from '@shared/intelligence';
import { Banner, Empty, SeverityBadge, Spinner, timeAgo, formatCount } from '../components/ui';

interface Snippet {
  path: string;
  startLine: number;
  endLine: number;
  lines: string[];
  totalLines: number;
  targetLine: number;
}

const PAGE_SIZE = 100;
const INITIAL_WORKSPACE: WorkspaceState = { search: '', severities: [], scanner: 'ALL', state: 'ALL', change: 'ALL', includeOtherBranches: false, groupByFix: false, pageIndex: 0, detailWidth: 48, scrollTop: 0 };
const CHANGE_LABELS: Record<string, string> = { NEW: 'New', PERSISTENT: 'Persistent', ESCALATED: 'Escalated', REDUCED: 'Reduced', UNCERTAIN: 'Uncertain' };

function mergeHistory(...lists: ScanHistoryItem[][]): ScanHistoryItem[] {
  return [...new Map(lists.flat().map((item) => [item.id, item])).values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function ResultsView() {
  const { settings, selectedScanId, linkedFolder, setSelectedScan, historyVersion, pendingAutoBaseline, clearAutoBaseline, setView, cachedScans, connectionId, refreshWorkbench, openSession } = useApp(useShallow((state) => ({
    settings: state.settings, selectedScanId: state.selectedScanId, linkedFolder: state.linkedFolder, setSelectedScan: state.setSelectedScan,
    historyVersion: state.historyVersion, pendingAutoBaseline: state.pendingAutoBaseline, clearAutoBaseline: state.clearAutoBaseline, setView: state.setView,
    cachedScans: state.cachedScans, connectionId: state.connectionId, refreshWorkbench: state.refreshWorkbench, openSession: state.openSession
  })));
  const [page, setPage] = useState<ResultsPage | null>(null);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [projectHistory, setProjectHistory] = useState<ScanHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyOffset = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refreshRequested = useRef(false);
  const [workspace, setWorkspace] = useState<WorkspaceState>(INITIAL_WORKSPACE);
  const [workspaceReady, setWorkspaceReady] = useState<string | null>(null);
  const pendingSave = useRef<{ key: string; state: WorkspaceState } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [comparison, setComparison] = useState<ScanComparison | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [remediation, setRemediation] = useState<RemediationSelection | null>(null);
  const [remediationTitle, setRemediationTitle] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupPage, setGroupPage] = useState(0);
  const [snippet, setSnippet] = useState<Snippet | null>(null);
  const [snippetError, setSnippetError] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<{ matches: boolean | null; message: string } | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const sourceRequest = useRef(0);
  const [editor, setEditor] = useState<'code' | 'cursor'>('code');
  const snippetRequest = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const resizePointer = useRef<number | null>(null);
  const workspaceKey = `results:${connectionId ?? 'offline'}:${selectedScanId ?? 'none'}`;
  const activePage = demo ? DEMO_RESULTS : page;
  const findings = activePage?.findings ?? [];
  const cves = useMemo(() => [...new Set(findings.map(f => findingCVE(f.cve)).filter((value): value is string => !!value))], [findings]);
  const {snapshots: intelligence, error: intelligenceError} = useIntelligence(demo ? [] : cves);
  const allHistory = useMemo(() => mergeHistory(cachedScans, history, projectHistory, page?.scan ? [page.scan] : []), [cachedScans, history, projectHistory, page?.scan]);
  const currentScan = page?.scan ?? allHistory.find((item) => item.id === selectedScanId);
  const updateWorkspace = (patch: Partial<WorkspaceState>) => {
    const resetResults = ['search', 'severities', 'scanner', 'state', 'change', 'intelligenceFilter', 'groupByFix'].some((key) => Object.hasOwn(patch, key));
    if (resetResults) { setGroupId(null); setGroupPage(0); }
    setWorkspace((current) => ({ ...current, ...patch, ...(resetResults ? { pageIndex: 0, scrollTop: 0 } : {}) }));
  };
  const setTablePage = (pageIndex: number) => updateWorkspace({ pageIndex, scrollTop: 0 });

  useEffect(() => {
    let current = true;
    setWorkspaceReady(null);
    setWorkspace(INITIAL_WORKSPACE);
    setChecked(new Set());
    setGroupId(null);
    setGroupPage(0);
    setSnippet(null);
    setSnippetError(null);
    setComparison(null);
    if (!selectedScanId || demo) { setWorkspaceReady(demo ? 'demo' : workspaceKey); return; }
    void api.workbench.workspace(workspaceKey).then((saved) => {
      if (!current) return;
      setWorkspace({ ...INITIAL_WORKSPACE, ...saved });
      if (saved?.linkedFolder && !linkedFolder) setSelectedScan(selectedScanId, saved.linkedFolder, pendingAutoBaseline);
      setWorkspaceReady(workspaceKey);
    }).catch((err) => {
      if (current) { setError(`Could not restore this workspace: ${err.message}`); setWorkspaceReady(workspaceKey); }
    });
    return () => { current = false; };
  }, [workspaceKey, demo]);

  useEffect(() => {
    if (demo || !selectedScanId || workspaceReady !== workspaceKey) return;
    pendingSave.current = { key: workspaceKey, state: { ...workspace, selectedScanId, linkedFolder } };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const pending = pendingSave.current;
      pendingSave.current = null;
      if (pending) void api.workbench.saveWorkspace(pending.key, pending.state).catch((err) => setError(`Could not save workspace: ${err.message}`));
    }, 200);
  }, [workspace, workspaceReady, workspaceKey, linkedFolder, selectedScanId, demo]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const pending = pendingSave.current;
    if (pending) void api.workbench.saveWorkspace(pending.key, pending.state).catch(() => undefined);
    snippetRequest.current++;
  }, []);

  useEffect(() => {
    if (!hasScanCredentials(settings)) return;
    let current = true;
    void api.scan.history({ limit: 100 }).then((items) => { if (current) setHistory(items); }).catch((err) => { if (current) setNotice(`Recent remote scans could not be refreshed. Saved evidence remains available. ${err.message}`); });
    return () => { current = false; };
  }, [connectionId, historyVersion, settings?.cliAuthMode, settings?.hasApiKey]);

  useEffect(() => {
    if (!currentScan?.projectId || demo || !hasScanCredentials(settings)) return;
    let current = true;
    setHistoryLoading(true);
    void api.scan.history({ projectId: currentScan.projectId, limit: 100, offset: 0 }).then((items) => { if (current) { setProjectHistory(items); historyOffset.current = items.length; } })
      .catch((err) => { if (current) setNotice(`Older scans could not be refreshed: ${err.message}`); })
      .finally(() => { if (current) setHistoryLoading(false); });
    return () => { current = false; };
  }, [currentScan?.projectId, connectionId, historyVersion, demo]);

  useEffect(() => {
    setPage(null);
    setError(null);
    setSnippet(null);
    setSnippetError(null);
    if (!selectedScanId || demo) { setLoading(false); return; }
    let current = true;
    const requestId = `results-${crypto.randomUUID()}`;
    const refresh = refreshRequested.current;
    refreshRequested.current = false;
    setLoading(true);
    void api.results.get(selectedScanId, { refresh, requestId }).then((data) => {
      if (current) { setPage(data); void refreshWorkbench().catch(() => undefined); }
    }).catch((err) => { if (current) setError(err.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; void api.results.cancel(requestId).catch(() => undefined); };
  }, [selectedScanId, connectionId, refreshVersion, demo]);

  useEffect(() => {
    if (demo || !selectedScanId || !page || loading || !workspace.baselineId || workspaceReady !== workspaceKey) { setComparison(null); setDiffLoading(false); return; }
    let current = true;
    setDiffLoading(true);
    setComparison(null);
    void api.results.compare(workspace.baselineId, selectedScanId).then((value) => { if (current) setComparison(value); })
      .catch((err) => { if (current) setError(`Comparison failed: ${err.message}`); })
      .finally(() => { if (current) setDiffLoading(false); });
    return () => { current = false; };
  }, [workspace.baselineId, selectedScanId, workspaceReady, workspaceKey, page, loading, demo]);

  const checkSource = async () => {
    if (!linkedFolder || !selectedScanId || demo) return;
    const request = ++sourceRequest.current;
    setSourceLoading(true);
    try { const status = await api.fs.sourceStatus(linkedFolder, selectedScanId); if (request === sourceRequest.current) setSourceStatus(status); }
    catch (err) { if (request === sourceRequest.current) setSourceStatus({ matches: null, message: err instanceof Error ? err.message : String(err) }); }
    finally { if (request === sourceRequest.current) setSourceLoading(false); }
  };
  useEffect(() => {
    const request = ++sourceRequest.current;
    setSourceStatus(null);
    if (!linkedFolder || !selectedScanId || demo) { setSourceLoading(false); return () => { sourceRequest.current++; }; }
    setSourceLoading(true);
    void api.fs.sourceStatus(linkedFolder, selectedScanId).then((status) => { if (request === sourceRequest.current) setSourceStatus(status); })
      .catch((err) => { if (request === sourceRequest.current) setSourceStatus({ matches: null, message: err.message }); })
      .finally(() => { if (request === sourceRequest.current) setSourceLoading(false); });
    return () => { sourceRequest.current++; };
  }, [linkedFolder, selectedScanId, page?.provenance, demo]);

  const filtered = useMemo(() => {
    const search = workspace.search?.trim().toLowerCase();
    return findings.filter((finding) => {
      if (!matchesIntelligence(intelligence[findingCVE(finding.cve) ?? ''], workspace.intelligenceFilter ?? 'all')) return false;
      if (workspace.severities?.length && !workspace.severities.includes(finding.severity)) return false;
      if (workspace.state && workspace.state !== 'ALL' && finding.state !== workspace.state) return false;
      if (workspace.scanner && workspace.scanner !== 'ALL' && finding.type !== workspace.scanner) return false;
      if (comparison && workspace.change && workspace.change !== 'ALL' && comparison.changes[finding.id] !== workspace.change) return false;
      return !search || `${finding.title} ${finding.where} ${finding.cve ?? ''} ${finding.cwe ?? ''} ${finding.packageName ?? ''} ${finding.group ?? ''}`.toLowerCase().includes(search);
    });
  }, [findings, workspace.search, workspace.severities, workspace.state, workspace.scanner, workspace.change, workspace.intelligenceFilter, intelligence, comparison]);
  const groups = useMemo(() => workspace.groupByFix ? groupFindings(filtered) : [], [filtered, workspace.groupByFix]);
  const activeGroup = groups.find((group) => group.id === groupId);
  const reviewFindings = useMemo(() => {
    if (!activeGroup) return filtered;
    const ids = new Set(activeGroup.findingIds);
    return filtered.filter((finding) => ids.has(finding.id));
  }, [filtered, activeGroup]);
  const selected = findings.find((finding) => finding.id === workspace.selectedFindingId) ?? null;
  const selectedIndex = reviewFindings.findIndex((finding) => finding.id === selected?.id);
  const counts = useMemo(() => {
    const result = emptySeverityCounts();
    for (const finding of findings) result[finding.severity]++;
    return result;
  }, [findings]);
  const candidates = useMemo(() => baselineCandidates(currentScan, allHistory, workspace.includeOtherBranches), [currentScan, allHistory, workspace.includeOtherBranches]);
  const hasFilters = Boolean((workspace.intelligenceFilter && workspace.intelligenceFilter !== 'all') || workspace.search || workspace.severities?.length || workspace.state !== 'ALL' || workspace.scanner !== 'ALL' || workspace.change !== 'ALL');
  const pageCount = Math.max(1, Math.ceil(reviewFindings.length / PAGE_SIZE));
  const displayPage = Math.min(Number.isFinite(workspace.pageIndex) ? Math.max(0, Math.floor(workspace.pageIndex!)) : 0, pageCount - 1);
  const visibleFindings = reviewFindings.slice(displayPage * PAGE_SIZE, (displayPage + 1) * PAGE_SIZE);
  const groupPageCount = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const displayedGroupPage = Math.min(groupPage, groupPageCount - 1);
  const visibleGroups = groups.slice(displayedGroupPage * PAGE_SIZE, (displayedGroupPage + 1) * PAGE_SIZE);

  useEffect(() => {
    if (workspaceReady && activePage && listRef.current) listRef.current.scrollTop = workspace.scrollTop ?? 0;
  }, [workspaceReady, activePage?.scan?.id, demo]);

  const selectFinding = (finding: Finding | null) => {
    snippetRequest.current++;
    setSnippet(null);
    setSnippetError(null);
    updateWorkspace({ selectedFindingId: finding?.id ?? null });
    if (!finding && selected) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-finding-id="${CSS.escape(selected.id)}"]`)?.focus());
  };
  const moveFinding = (direction: number) => {
    const next = reviewFindings[selectedIndex + direction];
    if (!next) return;
    setTablePage(Math.floor((selectedIndex + direction) / PAGE_SIZE));
    selectFinding(next);
  };
  const loadSnippet = async (finding: Finding, file: string, line: number) => {
    const request = ++snippetRequest.current;
    setSnippet(null);
    if (demo) { setSnippetError('Demo findings do not include local source.'); return; }
    if (!linkedFolder) { setSnippetError('Link the repository above to inspect current local source.'); return; }
    try {
      setSnippetError(null);
      const value = await api.fs.readSourceFile(linkedFolder, file.replace(/^\/+/, ''), line, finding.projectId);
      if (request === snippetRequest.current) setSnippet({ ...value, targetLine: line });
    } catch (err) { if (request === snippetRequest.current) setSnippetError(err instanceof Error ? err.message : String(err)); }
  };
  const openEditor = async () => {
    if (!selected || !linkedFolder || demo) return;
    const file = snippet?.path ?? selected.flow[0]?.fileName;
    if (!file) { setSnippetError('This finding has no source location that can be opened.'); return; }
    try { await api.fs.openInEditor(linkedFolder, file.replace(/^\/+/, ''), snippet?.targetLine ?? selected.flow[0]?.line ?? 1, selected.projectId, editor); }
    catch (err) { setSnippetError(err instanceof Error ? err.message : String(err)); }
  };
  const openRemediation = (group?: typeof activeGroup) => {
    if (!activePage || loading) return;
    const checkedFindings = findings.filter((finding) => checked.has(finding.id));
    const scopes = [{ id: 'all', name: 'All loaded findings', findings: [...findings] }];
    if (hasFilters) scopes.push({ id: 'filtered', name: 'Current results filters', findings: [...filtered] });
    if (selected) scopes.push({ id: 'finding', name: 'This finding', findings: [selected] });
    if (checkedFindings.length) scopes.push({ id: 'selection', name: 'Selected findings', findings: checkedFindings });
    if (group) { const ids = new Set(group.findingIds); scopes.push({ id: 'group', name: group.title, findings: findings.filter((finding) => ids.has(finding.id)) }); }
    const initialScope = group ? 'group' : checkedFindings.length ? 'selection' : selected ? 'finding' : hasFilters ? 'filtered' : 'all';
    const exact = scopes.find((item) => item.id === initialScope)!.findings;
    setRemediationTitle(group?.title ?? (exact.length === 1 ? exact[0].title : `${currentScan?.projectName ?? 'Scan'} remediation`));
    setRemediation({
      scopes, initialScope,
      initialSeverities: ['finding', 'selection', 'group'].includes(initialScope) ? [...new Set(exact.map((finding) => finding.severity))] : workspace.severities?.length ? workspace.severities : ['CRITICAL', 'HIGH'],
      context: { scanId: demo ? undefined : selectedScanId ?? undefined, sourceProvenance: demo ? undefined : page?.provenance, projectName: demo ? 'Demo project' : currentScan?.projectName, branch: demo ? undefined : currentScan?.branch, workspaceName: !demo && linkedFolder ? folderName(linkedFolder) : undefined, loadedCount: findings.length, totalCount: activePage.totalCount, truncated: Boolean(activePage.truncated), demo }
    });
  };
  const trackRemediation = async (input: { findingIds: string[]; handoff: string }) => {
    if (demo || !selectedScanId) return;
    const session = await api.workbench.createSession({ title: remediationTitle, scanId: selectedScanId, findingIds: input.findingIds, folderPath: linkedFolder ?? undefined, handoff: input.handoff });
    await refreshWorkbench();
    setRemediation(null);
    openSession(session.id);
  };
  const exportFindings = async (format: 'csv' | 'json' | 'sarif') => {
    try {
      if (format === 'sarif' && selectedScanId && !demo) await api.results.sarif(selectedScanId);
      else if (format !== 'sarif') await api.results.export(format, demo ? 'demo-findings' : `${currentScan?.projectName ?? 'scan'}-${selectedScanId?.slice(0, 8) ?? ''}`, filtered);
    } catch (err) { setError(`Export failed: ${err instanceof Error ? err.message : String(err)}`); }
  };
  const resize = (clientX: number) => {
    const bounds = splitRef.current?.getBoundingClientRect();
    if (bounds) updateWorkspace({ detailWidth: Math.max(32, Math.min(65, (bounds.right - clientX) / bounds.width * 100)) });
  };

  return (
    <section className="results-workspace" onKeyDown={(event) => {
      if (!selected || !(event.altKey && ['ArrowDown', 'ArrowUp'].includes(event.key))) return;
      event.preventDefault(); moveFinding(event.key === 'ArrowDown' ? 1 : -1);
    }}>
      <div className="row between workspace-heading">
        <div><div className="page-eyebrow">Findings explorer</div><h1 className="page-title">Results</h1><p className="page-sub">Investigate evidence, prepare a focused change, and verify it.</p></div>
        <div className="row">
          {selectedScanId && !demo && <button className="btn small" onClick={async () => {
            try {
              if (!currentScan?.projectId) throw new Error('Load the scan project before linking source.');
              const folder = await api.dialog.selectFolder();
              if (folder) { await api.bindings.save(folder, currentScan.projectId); setSelectedScan(selectedScanId, folder, pendingAutoBaseline); }
            } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
          }}><FolderOpen size={13} />{linkedFolder ? 'Change repository' : 'Link repository'}</button>}
          {selectedScanId && !demo && currentScan && settings?.baseUrl && <button className="btn ghost small" onClick={() => void api.shell.openExternal(`${settings.baseUrl.replace(/\/+$/, '')}/projects/${currentScan.projectId}/results?scanIds=${currentScan.id}`).catch((err) => setError(err.message))}><ExternalLink size={13} />Checkmarx One</button>}
        </div>
      </div>
      <div className="toolbar result-scan-toolbar">
        {(allHistory.length > 0 || hasScanCredentials(settings)) && <label className="field scan-picker">Scan<select aria-label="Scan" value={demo ? '' : selectedScanId ?? ''} onChange={(event) => { setDemo(false); setSelectedScan(event.target.value || null, null); }}>
          <option value="">Select a scan…</option>
          {selectedScanId && !allHistory.some((scan) => scan.id === selectedScanId) && <option value={selectedScanId}>{selectedScanId}</option>}
          {allHistory.map((scan) => <option value={scan.id} key={scan.id}>{scan.projectName} · {scan.branch} · {scan.status} · {timeAgo(scan.createdAt)}{cachedScans.some((cached) => cached.id === scan.id) ? ' · saved' : ''}</option>)}
        </select></label>}
        {activePage && <button className="btn primary small" disabled={loading || !findings.length} onClick={() => openRemediation(activeGroup)}><Sparkles size={14} />Fix with AI</button>}
        {selectedScanId && !demo && <button className="btn ghost small" disabled={loading} aria-label="Refresh findings" onClick={() => { refreshRequested.current = true; setRefreshVersion((version) => version + 1); }}><RefreshCw size={14} className={loading ? 'spin' : ''} />Refresh</button>}
        {activePage && <details className="export-menu"><summary className="btn ghost small">Export evidence</summary><div className="export-actions"><button className="btn small" disabled={!filtered.length} onClick={() => void exportFindings('csv')}>CSV</button><button className="btn small" disabled={!filtered.length} onClick={() => void exportFindings('json')}>JSON</button>{!demo && <button className="btn small" onClick={() => void exportFindings('sarif')}>SARIF</button>}</div></details>}
      </div>
      {!demo && currentScan && <div className="scan-context">
        <div className="row"><strong>{currentScan.projectName}</strong><span className="mono">{currentScan.branch}</span><span className="faint mono" title={currentScan.id}>{currentScan.id.slice(0, 12)}</span>{page?.cached && <span className="badge">Saved evidence</span>}{linkedFolder && <span className="faint mono" title={linkedFolder}>{folderName(linkedFolder)}</span>}</div>
        {page?.provenance ? <details><summary className="field-help">{page.provenance.source.commit ? `Revision ${page.provenance.source.commit.slice(0, 12)}` : 'Revision unavailable'} · {page.provenance.source.commit ? page.provenance.source.dirty ? 'Uncommitted changes at capture' : 'Clean worktree at capture' : 'Working-folder evidence'} · {page.provenance.requestedScanners.join(' + ').toUpperCase()}</summary><dl className="kv provenance-details"><dt>Captured</dt><dd>{new Date(page.provenance.capturedAt).toLocaleString()}</dd><dt>Scan source</dt><dd>{page.provenance.source.folderPath}</dd><dt>CLI</dt><dd>{page.provenance.cliVersion ?? 'Not recorded'}</dd><dt>Completed engines</dt><dd>{page.provenance.completedScanners?.join(', ') || 'Not confirmed'}</dd><dt>Preset</dt><dd>{page.provenance.options.sastPreset}</dd><dt>Exclusions</dt><dd>{page.provenance.options.excludes.join(', ') || 'CLI defaults'}</dd><dt>Source changed during scan</dt><dd>{page.provenance.sourceChanged === undefined ? 'Not established' : page.provenance.sourceChanged ? 'Yes' : 'No detected change'}</dd></dl></details> : <p className="field-help">Source revision and effective scan configuration were not captured for this scan.</p>}
        {linkedFolder && <div className={`source-status ${sourceStatus?.matches === false ? 'changed' : ''}`}><span>{sourceLoading ? 'Checking local source…' : sourceStatus?.message ?? 'Local source has not been checked.'}</span><button className="btn ghost small" disabled={sourceLoading} onClick={() => void checkSource()}>Check source</button></div>}
      </div>}
      {pendingAutoBaseline && !demo && <Banner kind="warn" action={<button className="btn small" onClick={clearAutoBaseline}>Dismiss</button>}>Choose an earlier baseline explicitly. Comparable coverage is required for a passing verification.</Banner>}
      {(demo || !selectedScanId) && <Banner kind="info" action={<div className="row"><button className="btn small" onClick={() => { setDemo((value) => !value); setError(null); }}>{demo ? 'Close demo' : 'Load demo results'}</button>{!hasScanCredentials(settings) && <button className="btn small" onClick={() => setView('settings')}>Connect account</button>}</div>}>{demo ? 'Demo scan · 9 sample findings. Triage and remediation tracking are read-only.' : 'Open saved evidence or explore a sample scan. Saved evidence stays available without a new scan.'}</Banner>}
      {!demo && notice && <Banner kind="warn" action={<button className="btn ghost small" aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={14} /></button>}>{notice}</Banner>}
      {activePage && !demo && currentScan && <div className="comparison-controls"><label className="field">Baseline<select aria-label="Baseline scan" value={workspace.baselineId ?? ''} onChange={(event) => updateWorkspace({ baselineId: event.target.value || null, change: 'ALL' })}><option value="">Choose baseline…</option>{workspace.baselineId && !candidates.some((scan) => scan.id === workspace.baselineId) && <option value={workspace.baselineId}>{workspace.baselineId.slice(0, 12)} · saved selection</option>}{candidates.map((scan) => <option key={scan.id} value={scan.id}>{scan.branch} · {new Date(scan.createdAt).toLocaleString()} · {scan.id.slice(0, 8)}</option>)}</select></label><label className="check"><input type="checkbox" checked={Boolean(workspace.includeOtherBranches)} onChange={(event) => updateWorkspace({ includeOtherBranches: event.target.checked, baselineId: null, change: 'ALL' })} />Show other branches</label><button className="btn ghost small" disabled={historyLoading} onClick={async () => { if (!currentScan?.projectId) return; setHistoryLoading(true); try { const more = await api.scan.history({ projectId: currentScan.projectId, offset: historyOffset.current, limit: 100 }); historyOffset.current += more.length; setProjectHistory((current) => mergeHistory(current, more)); if (!more.length) setNotice('No older scans were returned for this project.'); } catch (err) { setNotice(err instanceof Error ? err.message : String(err)); } finally { setHistoryLoading(false); } }}>{historyLoading ? 'Loading scans…' : 'Find older baselines'}</button></div>}
      {diffLoading && <div className="field-help" role="status">Comparing complete saved evidence…</div>}
      {comparison && !diffLoading && <div className="comparison-summary"><Banner kind={comparison.verdict === 'pass' ? 'ok' : comparison.verdict === 'attention' ? 'error' : 'warn'}><strong>{comparison.headline}</strong>{comparison.reasons.length > 0 && <ul>{comparison.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}</Banner><div className="row comparison-counts"><span>{comparison.newCount} new</span><span>{comparison.persistentCount} persistent</span><span>{comparison.escalatedCount} escalated</span><span>{comparison.reducedCount} reduced</span><span>{comparison.absent.length} absent</span></div>{comparison.absent.length > 0 && <details className="absent-findings"><summary>Review absent baseline findings ({comparison.absent.length})</summary><p className="field-help">Absence is not proof of remediation. Check coverage and comparison reasons above.</p><div className="bounded-list">{comparison.absent.map((finding) => <div className="row absent-row" key={finding.id}><SeverityBadge severity={finding.severity} /><span>{finding.title}</span><span className="mono faint">{finding.where}</span></div>)}</div></details>}</div>}
      {activePage && <>
        {!!cves.length && !demo && <div className="intel-results-toolbar"><IntelligenceRefresh cves={cves}/><select aria-label="Intelligence filter" value={workspace.intelligenceFilter ?? 'all'} onChange={event=>updateWorkspace({intelligenceFilter:event.target.value})}><option value="all">All intelligence states</option><option value="kev">KEV evidence, including cached</option><option value="epss">Fresh EPSS ≥ 10%</option><option value="unknown">No current intelligence</option></select><span className="field-help">Severity stays as reported by Checkmarx.</span></div>}
        {intelligenceError && <Banner kind="warn">{intelligenceError}</Banner>}
        <div className="toolbar result-filters"><div className="search-field"><Search size={14} /><input type="search" aria-label="Search findings" placeholder="Search findings, files, CVEs…" value={workspace.search ?? ''} onChange={(event) => updateWorkspace({ search: event.target.value })} /></div><select aria-label="Scanner filter" value={workspace.scanner ?? 'ALL'} onChange={(event) => updateWorkspace({ scanner: event.target.value })}><option value="ALL">All scanners</option>{[...new Set(findings.map((finding) => finding.type))].map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select><select aria-label="State filter" value={workspace.state ?? 'ALL'} onChange={(event) => updateWorkspace({ state: event.target.value })}><option value="ALL">All states</option>{RESULT_STATES.map((state) => <option key={state.value} value={state.value}>{state.label}</option>)}</select>{comparison && <select aria-label="Change filter" value={workspace.change ?? 'ALL'} onChange={(event) => updateWorkspace({ change: event.target.value })}><option value="ALL">All changes</option>{Object.entries(CHANGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}<button className={`btn small ${workspace.groupByFix ? 'selected' : ''}`} aria-pressed={Boolean(workspace.groupByFix)} onClick={() => { updateWorkspace({ groupByFix: !workspace.groupByFix }); setGroupId(null); }}><Layers size={14} />Group by fix</button>{hasFilters && <button className="btn ghost small" onClick={() => updateWorkspace({ search: '', severities: [], scanner: 'ALL', state: 'ALL', change: 'ALL' })}><X size={13} />Clear filters</button>}</div>
        <div className="row severity-filters">{SEVERITIES.map((severity) => <button key={severity} className={`chip clickable ${workspace.severities?.includes(severity) ? 'on' : ''}`} aria-pressed={workspace.severities?.includes(severity) ?? false} aria-label={`${SEVERITY_LABEL[severity]} severity, ${counts[severity]} findings`} onClick={() => updateWorkspace({ severities: workspace.severities?.includes(severity) ? workspace.severities.filter((value) => value !== severity) : [...(workspace.severities ?? []), severity] })}><span className="dot" style={{ background: SEVERITY_COLOR[severity] }} />{SEVERITY_LABEL[severity]}<span className="count">{formatCount(counts[severity])}</span></button>)}<span className="faint result-count">{formatCount(filtered.length)} of {formatCount(findings.length)} findings</span></div>
      </>}
      {activePage?.truncated && <Banner kind="warn">This evidence is incomplete: {formatCount(findings.length)} of {formatCount(activePage.totalCount)} findings are available. Exports include available evidence; verification cannot pass.</Banner>}
      {error && <Banner kind="error" action={<button className="btn ghost small" aria-label="Dismiss error" onClick={() => setError(null)}><X size={14} /></button>}>{error}</Banner>}
      {loading && <div className="empty" role="status"><Spinner size={22} /><span>Loading findings…</span></div>}
      {activePage && !loading && <>
        {workspace.groupByFix && !activeGroup && <><div className="remediation-groups">{visibleGroups.map((group) => <article className="remediation-group" key={group.id}><div className="row between"><div className="row"><SeverityBadge severity={group.severity} /><strong>{group.title}</strong></div><span className="faint">{group.findingIds.length} findings</span></div><p className="field-help">{group.rationale}</p><div className="row"><button className="btn small" onClick={() => { setGroupId(group.id); setTablePage(0); }}>Inspect group</button><button className="btn ghost small" onClick={() => openRemediation(group)}><Sparkles size={13} />Prepare fixes</button></div></article>)}</div><div className="pagination" aria-label="Fix group pages"><button className="btn ghost small" disabled={displayedGroupPage === 0} onClick={() => setGroupPage(displayedGroupPage - 1)}><ChevronLeft size={14} />Previous groups</button><span className="faint" aria-live="polite">{groups.length ? displayedGroupPage * PAGE_SIZE + 1 : 0}–{Math.min((displayedGroupPage + 1) * PAGE_SIZE, groups.length)} of {formatCount(groups.length)} fix groups</span><button className="btn ghost small" disabled={displayedGroupPage >= groupPageCount - 1} onClick={() => setGroupPage(displayedGroupPage + 1)}>Next groups<ChevronRight size={14} /></button></div></>}
        {(!workspace.groupByFix || activeGroup) && <>
          {activeGroup && <div className="group-context"><button className="btn ghost small" onClick={() => setGroupId(null)}><ChevronLeft size={13} />All fix groups</button><strong>{activeGroup.title}</strong><p className="field-help">{activeGroup.rationale}</p></div>}
          {checked.size > 0 && <div className="selection-toolbar"><span>{checked.size} selected</span><button className="btn small" onClick={() => openRemediation()}><Sparkles size={13} />Prepare selected fixes</button><button className="btn ghost small" onClick={() => setChecked(new Set())}>Clear selection</button></div>}
          <div ref={splitRef} className={`investigation-split ${selected ? 'has-detail' : ''}`} style={{ '--detail-width': `${workspace.detailWidth ?? 48}%` } as React.CSSProperties}>
            <div className="investigation-list">
              <div className="scroller results-table" ref={listRef} onScroll={(event) => updateWorkspace({ scrollTop: event.currentTarget.scrollTop })}><table className="data" aria-label="Scan findings"><thead><tr><th className="selection-cell"><input type="checkbox" aria-label="Select visible findings" checked={visibleFindings.length > 0 && visibleFindings.every((finding) => checked.has(finding.id))} onChange={(event) => setChecked((current) => { const next = new Set(current); for (const finding of visibleFindings) event.target.checked ? next.add(finding.id) : next.delete(finding.id); return next; })} /></th><th className="severity-cell">Severity</th><th>Finding</th>{!selected && <th>Location</th>}<th className="state-cell">State</th>{comparison && <th className="change-cell">Change</th>}</tr></thead><tbody>{visibleFindings.map((finding) => <tr key={finding.id} className={`clickable ${selected?.id === finding.id ? 'selected-finding' : ''}`} onClick={() => selectFinding(finding)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${finding.title}`} checked={checked.has(finding.id)} onChange={(event) => setChecked((current) => { const next = new Set(current); event.target.checked ? next.add(finding.id) : next.delete(finding.id); return next; })} /></td><td><SeverityBadge severity={finding.severity} /></td><td><button className="finding-link" data-finding-id={finding.id} title={finding.title} aria-label={`Open finding: ${finding.title}`} onClick={(event) => { event.stopPropagation(); selectFinding(finding); }}>{finding.title}</button><div className="faint finding-subtitle">{[finding.type.toUpperCase(), selected ? finding.where : finding.group].filter(Boolean).join(' · ')}{findingCVE(finding.cve) && <> · {intelligenceLabel(intelligence[findingCVE(finding.cve)!])}</>}</div></td>{!selected && <td className="mono dim">{finding.where || '—'}</td>}<td className="dim">{stateLabel(finding.state)}</td>{comparison && <td className={`change-${comparison.changes[finding.id]?.toLowerCase()}`}>{CHANGE_LABELS[comparison.changes[finding.id]] ?? 'Uncertain'}</td>}</tr>)}{!visibleFindings.length && <tr><td colSpan={selected ? 5 : 7}><div className="empty">{hasFilters ? 'No findings match these filters.' : 'No findings returned for this scan.'}</div></td></tr>}</tbody></table></div>
              <div className="pagination"><button className="btn ghost small" disabled={displayPage === 0} onClick={() => { setTablePage(displayPage - 1); listRef.current?.scrollTo(0, 0); }}><ChevronLeft size={14} />Previous</button><span className="faint" aria-live="polite">{reviewFindings.length ? displayPage * PAGE_SIZE + 1 : 0}–{Math.min((displayPage + 1) * PAGE_SIZE, reviewFindings.length)} of {formatCount(reviewFindings.length)}</span><button className="btn ghost small" disabled={displayPage >= pageCount - 1} onClick={() => { setTablePage(displayPage + 1); listRef.current?.scrollTo(0, 0); }}>Next<ChevronRight size={14} /></button></div>
            </div>
            {selected && <><div className="detail-resizer" role="separator" aria-label="Resize finding details" aria-orientation="vertical" aria-valuemin={32} aria-valuemax={65} aria-valuenow={Math.round(workspace.detailWidth ?? 48)} tabIndex={0} onPointerDown={(event) => { resizePointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (resizePointer.current === event.pointerId) resize(event.clientX); }} onPointerUp={(event) => { resizePointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { resizePointer.current = null; }} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); updateWorkspace({ detailWidth: event.key === 'Home' ? 32 : event.key === 'End' ? 65 : Math.max(32, Math.min(65, (workspace.detailWidth ?? 48) + (event.key === 'ArrowLeft' ? 2 : -2))) }); }} /><div className="investigation-detail"><div className="detail-navigation"><button className="btn ghost small" disabled={selectedIndex <= 0} onClick={() => moveFinding(-1)} title="Previous finding (Alt+↑)"><ChevronLeft size={14} />Previous</button><span className="faint">{selectedIndex >= 0 ? `${selectedIndex + 1} of ${reviewFindings.length}` : 'Outside current filters'}</span><button className="btn ghost small" disabled={selectedIndex < 0 || selectedIndex >= reviewFindings.length - 1} onClick={() => moveFinding(1)} title="Next finding (Alt+↓)">Next<ChevronRight size={14} /></button></div>{!demo && linkedFolder && <div className="editor-actions"><select aria-label="Source editor" value={editor} onChange={(event) => setEditor(event.target.value as 'code' | 'cursor')}><option value="code">VS Code</option><option value="cursor">Cursor</option></select><button className="btn small" disabled={!selected.flow.length} onClick={() => void openEditor()}><ExternalLink size={13} />Open in editor</button></div>}<FindingDetail finding={selected} onBack={() => selectFinding(null)} onOpenFlow={(finding, file, line) => void loadSnippet(finding, file, line)} snippet={snippet} snippetError={snippetError} onTriageDone={() => { refreshRequested.current = true; setRefreshVersion((version) => version + 1); }} readOnly={demo} /></div></>}
          </div>
        </>}
      </>}
      {remediation && <RemediationDialog selection={remediation} onClose={() => setRemediation(null)} onTrack={demo ? undefined : trackRemediation} />}
      {!activePage && !loading && !error && <Empty icon={<ListChecks size={36} strokeWidth={1.3} />} title="Choose a scan to investigate" hint="Saved scans, comparison context, and remediation sessions stay together on this computer." action={<button className="btn" onClick={() => setView('scan')}>Start a scan</button>} />}
    </section>
  );
}

function stateLabel(s: ResultState): string {
  return RESULT_STATES.find((r) => r.value === s)?.label ?? s;
}

function FindingDetail({
  finding,
  onBack,
  onOpenFlow,
  snippet,
  snippetError,
  onTriageDone,
  readOnly = false
}: {
  finding: Finding;
  onBack: () => void;
  onOpenFlow: (f: Finding, file: string, line: number) => void;
  snippet: Snippet | null;
  snippetError: string | null;
  onTriageDone: () => void;
  readOnly?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [finding.id]);
  const [state, setState] = useState<ResultState>(finding.state);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    setState(finding.state);
    setComment('');
    setResult(null);
  }, [finding.id, finding.state]);

  const submit = async () => {
    if (readOnly || busy) return;
    if (!comment.trim()) { setResult({ ok: false, msg: 'A comment is required when changing a result state.' }); return; }
    setBusy(true);
    setResult(null);
    try {
      await api.results.triage({ finding, state, comment });
      setResult({ ok: true, msg: 'Saved — applies to all findings with this similarity ID.' });
      onTriageDone();
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="findings-layout" onKeyDown={(e) => { if (e.key === 'Escape' && !busy && !(e.target instanceof HTMLSelectElement)) { e.preventDefault(); onBack(); } }}>
      <div className="detail-panel">
        <div className="row between" style={{ marginBottom: 10 }}>
          <button className="btn ghost small" onClick={onBack}>
            <ChevronLeft size={14} /> All findings
          </button>
          <SeverityBadge severity={finding.severity} />
        </div>

        <h2 className="finding-heading" tabIndex={-1} ref={heading}>{finding.title}</h2>
        <div className="dim" style={{ fontSize: 12 }}>
          {finding.type.toUpperCase()}
          {finding.language && ` · ${finding.language}`}
          {finding.cvssScore != null && ` · CVSS ${finding.cvssScore}`}
          {finding.cwe && ` · CWE-${String(finding.cwe).replace(/^CWE-?/i, '')}`}
          {finding.status === 'RECURRENT' && ' · Recurrent'}
        </div>

        <FindingIntelligence finding={finding} readOnly={readOnly} />
        <dl className="kv">
          {finding.where && (
            <>
              <dt>Location</dt>
              <dd className="mono">{finding.where}</dd>
            </>
          )}
          {finding.group && (
            <>
              <dt>Group</dt>
              <dd>{finding.group}</dd>
            </>
          )}
          {finding.packageName && (
            <>
              <dt>Package</dt>
              <dd className="mono">
                {finding.packageName}
                {finding.packageVersion ? `@${finding.packageVersion}` : ''}
                {finding.isDirectDependency != null &&
                  ` · ${finding.isDirectDependency ? 'direct' : 'transitive'}`}
              </dd>
            </>
          )}
          {finding.recommendedVersion && (
            <>
              <dt>Fix</dt>
              <dd className="mono">
                Upgrade to {finding.recommendedVersion}
                {finding.fixLink && (
                  <>
                    {' '}
                    <a href="#" onClick={(e) => { e.preventDefault(); void api.shell.openExternal(finding.fixLink!); }}>
                      reference
                    </a>
                  </>
                )}
              </dd>
            </>
          )}
          {finding.compliances && finding.compliances.length > 0 && (
            <>
              <dt>Compliance</dt>
              <dd>{finding.compliances.join(', ')}</dd>
            </>
          )}
          {finding.vendorId && <><dt>Scanner result ID</dt><dd className="mono">{finding.vendorId}</dd></>}
          <dt>State</dt>
          <dd>{stateLabel(finding.state)} · {finding.status}</dd>
        </dl>

        {finding.description && (
          <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-dim)' }}>
            {finding.description}
          </div>
        )}

        {finding.flow.length > 0 && (
          <>
            <div className="section-title">
              <FileCode2 size={14} /> {finding.type === 'sca' ? 'Dependency locations' : 'Attack flow (source → sink)'}
            </div>
            {finding.flow.map((n, i) => (
              <button
                type="button"
                className="flow-step"
                key={i}
                aria-label={`Show source: ${n.fileName}, line ${n.line}`}
                onClick={() => onOpenFlow(finding, n.fileName, n.line)}
              >
                <span className="n">{i + 1}.</span>
                <span className="loc">
                  {n.fileName.replace(/^\/+/, '')}
                  {n.line ? `:${n.line}` : ''}
                </span>
                {n.name && <span className="dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}</span>}
              </button>
            ))}
            {finding.type === 'sast' && (
              <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
                Click a step to show the code around it.
              </div>
            )}
          </>
        )}

        {snippet && (
          <div className="code-block">
            {snippet.lines.map((line, i) => {
              const ln = snippet.startLine + i;
              const hot = ln === snippet.targetLine;
              return (
                <div className={`line ${hot ? 'hot' : ''}`} key={i}>
                  <span className="ln">{ln}</span>
                  <span>{line || ' '}</span>
                </div>
              );
            })}
            <div className="faint" style={{ padding: '6px 12px 0', fontSize: 10.5 }}>
              {snippet.path} · lines {snippet.startLine}–{snippet.endLine} of {snippet.totalLines}
            </div>
          </div>
        )}
        {snippetError && <Banner kind="warn">{snippetError}</Banner>}

        <div className="triage-box">
          <div className="section-title" style={{ marginTop: 0 }}>
            Triage
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <select aria-label="Triage state" disabled={readOnly || busy} value={state} onChange={(e) => setState(e.target.value as ResultState)}>
              {RESULT_STATES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              aria-label="Triage comment"
              disabled={readOnly || busy}
              placeholder="Comment (required)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn primary small" disabled={busy || readOnly} onClick={() => void submit()}>
              {busy ? <Spinner size={12} /> : 'Apply'}
            </button>
          </div>
          {readOnly && <p className="field-help">Demo findings are read-only. Connect your account to triage your own findings.</p>}
          {result && (
            <Banner kind={result.ok ? 'ok' : 'error'}>{result.msg}</Banner>
          )}
        </div>
      </div>
    </div>
  );
}
