import { folderName } from '@shared/path';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ExternalLink,
  FileCode2,
  ListChecks,
  RefreshCw,
  Search, FolderOpen, X
} from 'lucide-react';
import type { Finding, ResultState, ResultsPage, ScanHistoryItem, Severity } from '@shared/types';
import { RESULT_STATES, emptySeverityCounts } from '@shared/types';
import { SEVERITIES, SEVERITY_COLOR, SEVERITY_LABEL } from '@shared/severity';
import { computeVerdict } from '@shared/verdict';
import { api } from '../api';
import { useApp } from '../store';
import { DEMO_RESULTS } from '../demo';
import { Banner, Empty, SeverityBadge, Spinner, timeAgo, formatCount } from '../components/ui';

interface Snippet {
  path: string;
  startLine: number;
  endLine: number;
  lines: string[];
  totalLines: number;
  targetLine: number;
}

export function ResultsView() {
  const { settings, selectedScanId, linkedFolder, setSelectedScan, historyVersion, pendingAutoBaseline, clearAutoBaseline, setView } = useApp();

  const loadedScan = useRef<string | null>(null);
  const baselineRequest = useRef(0);
  const snippetRequest = useRef(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [baselineTruncated, setBaselineTruncated] = useState(false);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [page, setPage] = useState<ResultsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [visible, setVisible] = useState(300);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set());
  const [stateFilter, setStateFilter] = useState<ResultState | 'ALL'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'sast' | 'sca'>('ALL');
  const [search, setSearch] = useState('');
  const [snippet, setSnippet] = useState<Snippet | null>(null);
  const [snippetError, setSnippetError] = useState<string | null>(null);

  // scan-to-scan diff (vs an earlier completed scan of the same project)
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [baselineFindings, setBaselineFindings] = useState<Finding[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [changeFilter, setChangeFilter] = useState<'ALL' | 'NEW' | 'RECURRENT'>('ALL');
  const [showFixed, setShowFixed] = useState(false);

  const activePage = demo ? DEMO_RESULTS : page;
  const findings = activePage?.findings ?? [];
  const returnFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedId && returnFocus.current) {
      document.querySelector<HTMLButtonElement>(`[data-finding-id="${CSS.escape(returnFocus.current)}"]`)?.focus();
      returnFocus.current = null;
    }
  }, [selectedId]);

  const clearFilters = () => { setSearch(''); setSevFilter(new Set()); setStateFilter('ALL'); setTypeFilter('ALL'); setChangeFilter('ALL'); };
  const hasFilters = Boolean(search || sevFilter.size || stateFilter !== 'ALL' || typeFilter !== 'ALL' || changeFilter !== 'ALL');

  useEffect(() => {
    if (!settings?.hasApiKey) return;
    let current = true;
    setHistoryLoading(true);
    api.scan.history().then((items) => { if (current) setHistory(items); })
      .catch((e) => { if (current) setError(e.message); })
      .finally(() => { if (current) setHistoryLoading(false); });
    return () => { current = false; };
  }, [settings?.hasApiKey, historyVersion]);

  useEffect(() => {
    const changedScan = loadedScan.current !== selectedScanId;
    loadedScan.current = selectedScanId;
    if (changedScan) setPage(null);
    if (changedScan) baselineRequest.current++;
    snippetRequest.current++;
    setSnippet(null);
    setSnippetError(null);
    if (changedScan) { setBaselineId(null); setBaselineFindings(null); setBaselineTruncated(false); setDiffLoading(false); }
    if (!selectedScanId) { setLoading(false); return; }
    let current = true;
    setDemo(false);
    setLoading(true);
    setError(null);
    if (changedScan) { setSelectedId(null); setChangeFilter('ALL'); setShowFixed(false); setVisible(300); }
    api.results
      .get(selectedScanId)
      .then((p) => { if (current) setPage(p); })
      .catch((e) => { if (current) setError(e.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [selectedScanId, refreshVersion]);

  useEffect(() => {
    if (!selectedScanId || linkedFolder) return;
    const project = history.find((h) => h.id === selectedScanId)?.projectName;
    const match = settings?.recentFolders.find((f) => folderName(f).toLowerCase() === project?.toLowerCase());
    if (match) setSelectedScan(selectedScanId, match, pendingAutoBaseline);
  }, [selectedScanId, linkedFolder, history, settings?.recentFolders]);

  useEffect(() => () => { baselineRequest.current++; snippetRequest.current++; }, []);

  const selected = findings.find((f) => f.id === selectedId) ?? null;

  const findingKey = (f: Finding) => `${f.type}|${f.similarityId || `${f.title}|${f.where}`}`;

  const baselineCandidates = useMemo(() => {
    const cur = history.find((h) => h.id === selectedScanId);
    if (!cur) return [];
    return history.filter(
      (h) =>
        h.projectId === cur.projectId &&
        h.id !== cur.id &&
        h.status === 'Completed' &&
        new Date(h.createdAt) <= new Date(cur.createdAt)
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [history, selectedScanId]);

  const diff = useMemo(() => {
    if (!baselineFindings || !page || page.truncated || baselineTruncated) return null;
    const baseKeys = new Set(baselineFindings.map(findingKey));
    const curKeys = new Set(page.findings.map(findingKey));
    const changeById = new Map<string, 'NEW' | 'RECURRENT'>();
    const newBySeverity: Partial<Record<Finding['severity'], number>> = {};
    let newCount = 0;
    let recurrentCount = 0;
    for (const f of page.findings) {
      if (baseKeys.has(findingKey(f))) {
        changeById.set(f.id, 'RECURRENT');
        recurrentCount++;
      } else {
        changeById.set(f.id, 'NEW');
        newCount++;
        newBySeverity[f.severity] = (newBySeverity[f.severity] ?? 0) + 1;
      }
    }
    const fixed = baselineFindings.filter((f) => !curKeys.has(findingKey(f)));
    return { changeById, newBySeverity, newCount, recurrentCount, fixed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineFindings, page, baselineTruncated]);

  const verdict = useMemo(
    () => (diff && history.find((h) => h.id === selectedScanId)?.status === 'Completed' ? computeVerdict({ newBySeverity: diff.newBySeverity }) : null),
    [diff, history, selectedScanId]
  );

  const pickBaseline = (id: string) => {
    const request = ++baselineRequest.current;
    setDiffLoading(false);
    setBaselineTruncated(false);
    setBaselineId(id || null);
    setBaselineFindings(null);
    setChangeFilter('ALL');
    setShowFixed(false);
    if (!id) return;
    setDiffLoading(true);
    api.results
      .get(id)
      .then((p) => { if (request === baselineRequest.current) { setBaselineFindings(p.findings); setBaselineTruncated(Boolean(p.truncated)); } })
      .catch((e) => { if (request === baselineRequest.current) setError(`Could not load baseline scan: ${e.message}`); })
      .finally(() => { if (request === baselineRequest.current) setDiffLoading(false); });
  };

  // story-check landing: auto-pick the most recent prior scan as baseline
  useEffect(() => {
    if (!pendingAutoBaseline || historyLoading || history.length === 0 || loading || !page || page.findings.some((f) => f.scanId !== selectedScanId)) return;
    clearAutoBaseline();
    if (baselineCandidates.length > 0) pickBaseline(baselineCandidates[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoBaseline, loading, page, baselineCandidates, historyLoading, history]);

  // reset windowing whenever the filter set changes
  useEffect(() => {
    setVisible(300);
  }, [sevFilter, stateFilter, typeFilter, changeFilter, search, selectedScanId, baselineId]);

  const doExport = async (format: 'csv' | 'json') => {
    const cur = history.find((h) => h.id === selectedScanId);
    const label = demo ? 'demo-findings' : `${cur?.projectName ?? 'scan'}-${selectedScanId?.slice(0, 8) ?? ''}`;
    try {
      await api.results.export(format, label, filtered);
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const counts = useMemo(() => {
    const c = emptySeverityCounts();
    for (const f of findings) c[f.severity]++;
    return c;
  }, [findings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return findings.filter((f) => {
      if (sevFilter.size > 0 && !sevFilter.has(f.severity)) return false;
      if (stateFilter !== 'ALL' && f.state !== stateFilter) return false;
      if (typeFilter !== 'ALL' && f.type !== typeFilter) return false;
      if (diff && changeFilter !== 'ALL' && diff.changeById.get(f.id) !== changeFilter) return false;
      if (
        q &&
        !`${f.title} ${f.where} ${f.cve ?? ''} ${f.packageName ?? ''} ${f.group ?? ''}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [findings, sevFilter, stateFilter, typeFilter, search, diff, changeFilter]);

  const loadSnippet = async (f: Finding, fileName?: string, line?: number) => {
    const request = ++snippetRequest.current;
    if (demo) { setSnippetError('Source files are not included in the demo. Run a scan of your own project to explore code snippets.'); return; }
    const file = fileName ?? f.flow[0]?.fileName;
    const target = line ?? f.flow[0]?.line ?? 1;
    if (!file) return;
    if (!linkedFolder) {
      setSnippetError('Link the local folder (in the toolbar above) to view source snippets.');
      setSnippet(null);
      return;
    }
    try {
      setSnippetError(null);
      const s = await api.fs.readSourceFile(linkedFolder, file.replace(/^\/+/, ''), target);
      if (request === snippetRequest.current) setSnippet({ ...s, targetLine: target });
    } catch (e) {
      if (request !== snippetRequest.current) return;
      setSnippet(null);
      setSnippetError(`Could not read ${file} — was the scan run from another machine?`);
    }
  };

  const openInWeb = () => {
    const h = history.find((x) => x.id === selectedScanId);
    if (!h || !settings?.baseUrl) return;
    const base = settings.baseUrl.replace(/\/+$/, '');
    void api.shell.openExternal(
      `${base}/projects/${h.projectId}/results?scanIds=${h.id}`
    );
  };

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <div className="page-eyebrow">Findings explorer</div>
          <h1 className="page-title">Results</h1>
          <p className="page-sub">Review vulnerabilities, follow their source, and compare scans.</p>
        </div>
        <div className="row">
          {selectedScanId && !demo && (
            <button className="btn small" onClick={async () => {
              try {
                const folder = await api.dialog.selectFolder();
                if (folder) { snippetRequest.current++; setSnippet(null); setSnippetError(null); setSelectedScan(selectedScanId, folder, pendingAutoBaseline); }
              } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            }}><FolderOpen size={13} />{linkedFolder ? 'Change source folder' : 'Link source folder'}</button>
          )}
          {!demo && linkedFolder && (
            <span className="faint mono" title={linkedFolder}>
              {folderName(linkedFolder)}
            </span>
          )}
          {selectedScanId && history.length > 0 && settings?.baseUrl && (
            <button className="btn ghost small" onClick={openInWeb}>
              <ExternalLink size={13} /> Open in Checkmarx One
            </button>
          )}
        </div>
      </div>

      {/* toolbar */}
      <div className="toolbar">
        {settings?.hasApiKey && (
          <select
            aria-label="Scan"
            value={selectedScanId ?? ''}
            onChange={(e) => setSelectedScan(e.target.value || null, null)}
            style={{ minWidth: 'min(260px, 100%)' }}
          >
            <option value="">Select a scan…</option>
            {history.map((h) => (
              <option key={h.id} value={h.id}>
                {h.projectName} · {h.branch} · {h.status} · {timeAgo(h.createdAt)}
              </option>
            ))}
          </select>
        )}

        {activePage && (
          <>
            <div className="grow" />
            <div className="row" style={{ gap: 6 }}>
              <Search size={13} className="dim" />
              <input
                type="text"
                aria-label="Search findings"
                placeholder="Search findings…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 200 }}
              />
            </div>
            <select aria-label="Scanner filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
              <option value="ALL">All scanners</option>
              <option value="sast">SAST</option>
              <option value="sca">SCA</option>
            </select>
            <select aria-label="State filter" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as ResultState | 'ALL')}>
              <option value="ALL">All states</option>
              {RESULT_STATES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {baselineCandidates.length > 0 && (
              <select
                aria-label="Baseline scan"
                value={baselineId ?? ''}
                onChange={(e) => pickBaseline(e.target.value)}
                title="Compare this scan against an earlier scan of the same project"
              >
                <option value="">Compare: off</option>
                {baselineCandidates.map((h) => (
                  <option key={h.id} value={h.id}>
                    vs {timeAgo(h.createdAt)} ({h.branch})
                  </option>
                ))}
              </select>
            )}
            {diff && (
              <select aria-label="Change filter" value={changeFilter} onChange={(e) => setChangeFilter(e.target.value as typeof changeFilter)}>
                <option value="ALL">All changes</option>
                <option value="NEW">New only</option>
                <option value="RECURRENT">Recurrent only</option>
              </select>
            )}
            {activePage && (
              <button
                className="btn small"
                disabled={loading || !filtered.length}
                onClick={() => void doExport('csv')}
                title="Export the filtered findings to ~/Downloads"
              >
                CSV
              </button>
            )}
            {activePage && (
              <button
                className="btn small"
                disabled={loading || !filtered.length}
                onClick={() => void doExport('json')}
                title="Export the filtered findings to ~/Downloads"
              >
                JSON
              </button>
            )}
            {selectedScanId && (
              <button
                className="btn ghost small"
                onClick={() => setRefreshVersion((v) => v + 1)}
                disabled={loading}
                aria-label="Refresh findings"
                title="Refresh"
              >
                <RefreshCw size={13} />
              </button>
            )}
            {hasFilters && <button className="btn ghost small" onClick={clearFilters}><X size={12} />Clear filters</button>}
          </>
        )}
      </div>

      {(demo || !settings?.hasApiKey) && (
        <Banner
          kind="info"
          action={
            <div className="row">
              <button className="btn small" onClick={() => { setDemo(!demo); setSelectedId(null); clearFilters(); }}>{demo ? 'Close demo' : 'Load demo results'}</button>
              {!settings?.hasApiKey && <button className="btn small" onClick={() => setView('settings')}>Connect account</button>}
            </div>
          }
        >
          {demo ? 'Demo scan · 9 sample findings. Triage is read-only in this preview.' : 'Explore a sample scan, or connect your account to see your findings.'}
        </Banner>
      )}


      {/* story-check verdict */}
      {verdict && !diffLoading && (
        <div className={`banner ${verdict.pass ? 'ok' : 'error'}`} style={{ marginBottom: 12 }}>
          {verdict.pass ? '✓ Story looks clean — ' : '⚠ Needs attention before CI — '}
          <strong>{verdict.headline}</strong>
          {verdict.newMedium > 0 && <span className="dim"> ({verdict.newMedium} medium, {verdict.newLow} low)</span>}
        </div>
      )}

      {/* scan-to-scan diff */}
      {baselineId && (
        <div className="banner info" style={{ marginBottom: 12 }}>
          {diffLoading ? (
            'Loading baseline scan…'
          ) : diff ? (
            <>
              Compared with{' '}
              <strong>{history.find((h) => h.id === baselineId)?.projectName}</strong> ·{' '}
              <b style={{ color: 'var(--critical)' }}>{diff.newCount} new</b> ·{' '}
              <b style={{ color: 'var(--text-dim)' }}>{diff.recurrentCount} recurrent</b> ·{' '}
              <b style={{ color: 'var(--ok)' }}>{diff.fixed.length} fixed</b>
              {diff.fixed.length > 0 && (
                <button className="btn ghost small" onClick={() => setShowFixed(!showFixed)}>
                  {showFixed ? 'Hide' : 'Show'} fixed
                </button>
              )}
            </>
          ) : null}
        </div>
      )}
      {showFixed && diff && diff.fixed.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            Fixed since baseline ({diff.fixed.length})
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {diff.fixed.slice(0, 100).map((f) => (
              <div key={f.id} className="row" style={{ padding: '3px 0', gap: 10 }}>
                <SeverityBadge severity={f.severity} />
                <span className="finding-title" style={{ flex: 1 }}>
                  {f.title}
                </span>
                <span className="mono faint">{f.where}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* severity chips */}
      {activePage && (
        <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          {SEVERITIES.map((s) => {
            const on = sevFilter.has(s);
            return (
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${SEVERITY_LABEL[s]} severity, ${counts[s]} ${counts[s] === 1 ? 'finding' : 'findings'}`}
                key={s}
                className={`chip clickable ${on ? 'on' : ''}`}
                onClick={() => {
                  const next = new Set(sevFilter);
                  if (on) next.delete(s);
                  else next.add(s);
                  setSevFilter(next);
                }}
              >
                <span className="dot" style={{ background: SEVERITY_COLOR[s] }} />
                {SEVERITY_LABEL[s]}
                <span className="count">{formatCount(counts[s])}</span>
              </button>
            );
          })}
          <span className="faint" style={{ marginLeft: 'auto' }}>
            {formatCount(filtered.length)} of {formatCount(findings.length)} {findings.length === 1 ? 'finding' : 'findings'}
          </span>
        </div>
      )}

      {loading && (
        <div className="empty">
          <Spinner size={22} />
          <div style={{ marginTop: 10 }}>Fetching findings…</div>
        </div>
      )}

      {(page?.truncated || baselineTruncated) && <Banner kind="warn">Only the first 5,000 findings were loaded. Export includes loaded findings only; diff and verdict are unavailable for incomplete results.</Banner>}
      {error && <Banner kind="error">{error}</Banner>}

      {activePage && !loading && (
        <FindingsLayout
          key={demo ? 'demo' : selectedScanId ?? 'none'}
          readOnly={demo}
          hasFilters={hasFilters}
          findings={filtered.slice(0, visible)}
          selected={selected}
          changeById={diff?.changeById}
          showMore={
            filtered.length > visible
              ? { remaining: filtered.length - visible, onShowMore: () => setVisible((v) => v + 300) }
              : undefined
          }
          onSelect={(f) => {
          snippetRequest.current++;
          if (!f) returnFocus.current = selectedId;
          setSelectedId(f?.id ?? null);
          setSnippet(null);
          setSnippetError(null);
        }}
          onOpenFlow={(f, file, line) => void loadSnippet(f, file, line)}
          snippet={snippet}
          snippetError={snippetError}
          onTriageDone={() => setRefreshVersion((v) => v + 1)}
        />
      )}

      {!activePage && !loading && !error && (
        <Empty
          icon={<ListChecks size={38} strokeWidth={1.2} />}
          title={settings?.hasApiKey ? "Choose a scan to explore" : "Your findings, in focus"}
          hint={settings?.hasApiKey ? "Select a completed scan above, or start a new scan of your project." : "Search, filter, and follow vulnerabilities back to their source. Start with a sample scan to explore the workflow."}
          action={<button className="btn" onClick={() => settings?.hasApiKey ? setView('scan') : (setDemo(true), clearFilters())}>{settings?.hasApiKey ? 'Start a scan' : 'Explore demo scan'}</button>}
        />
      )}
    </>
  );
}

function FindingsLayout({
  findings,
  selected,
  changeById,
  showMore,
  onSelect,
  onOpenFlow,
  snippet,
  snippetError,
  onTriageDone,
  readOnly = false,
  hasFilters = false
}: {
  hasFilters?: boolean;
  findings: Finding[];
  selected: Finding | null;
  changeById?: Map<string, 'NEW' | 'RECURRENT'>;
  showMore?: { remaining: number; onShowMore: () => void };
  onSelect: (f: Finding | null) => void;
  onOpenFlow: (f: Finding, file: string, line: number) => void;
  snippet: Snippet | null;
  snippetError: string | null;
  onTriageDone: () => void;
  readOnly?: boolean;
}) {
  if (!selected) {
    return (
      <div className="scroller results-table">
        <table className="data" aria-label="Scan findings">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Severity</th>
              <th>Finding</th>
              <th style={{ width: 240 }}>Location</th>
              <th style={{ width: 130 }}>State</th>
              <th style={{ width: 70 }}>Type</th>
              {changeById && <th style={{ width: 95 }}>Change</th>}
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id} className="clickable" onClick={() => onSelect(f)}>
                <td>
                  <SeverityBadge severity={f.severity} />
                </td>
                <td>
                  <button className="finding-link" title={f.title} data-finding-id={f.id} aria-label={`Open finding: ${f.title}`} onClick={(e) => { e.stopPropagation(); onSelect(f); }}>{f.title}</button>
                  {f.group && <div className="faint" style={{ fontSize: 11 }}>{f.group}</div>}
                </td>
                <td className="mono dim" title={f.where}>
                  {f.where || '—'}
                </td>
                <td className="dim">{stateLabel(f.state)}</td>
                <td className="faint" style={{ textTransform: 'uppercase' }}>{f.type}</td>
                {changeById && (
                  <td>
                    {changeById.get(f.id) === 'NEW' ? (
                      <span className="badge failed" style={{ background: 'transparent', padding: 0 }}>New</span>
                    ) : (
                      <span className="faint">Recurrent</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {findings.length === 0 && !showMore && (
              <tr>
                <td colSpan={changeById ? 6 : 5}>
                  <div className="empty">{hasFilters ? 'No findings match these filters.' : 'No findings were returned for this scan.'}</div>
                </td>
              </tr>
            )}
            {showMore && (
              <tr><td colSpan={changeById ? 6 : 5} className="show-more-cell"><button className="btn ghost" onClick={showMore.onShowMore}>Show {Math.min(300, showMore.remaining)} more <span className="faint">{showMore.remaining} remaining</span></button></td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <FindingDetail
      finding={selected}
      onBack={() => onSelect(null)}
      onOpenFlow={onOpenFlow}
      snippet={snippet}
      snippetError={snippetError}
      onTriageDone={onTriageDone}
      readOnly={readOnly}
    />
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
