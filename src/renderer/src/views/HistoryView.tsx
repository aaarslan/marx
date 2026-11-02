import { useShallow } from 'zustand/react/shallow';
import { hasScanCredentials } from '@shared/types';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, History as HistoryIcon, RefreshCw, Search } from 'lucide-react';
import type { ProjectInfo, ScanHistoryItem } from '@shared/types';
import { api } from '../api';
import { useApp } from '../store';
import { Banner, Empty, StatusBadge, timeAgo } from '../components/ui';

const PAGE_SIZE = 50;

export function HistoryView() {
  const { settings, setSelectedScan, setView, historyVersion, cachedScans, connectionId, initialized } = useApp(useShallow((state) => ({
    settings: state.settings, setSelectedScan: state.setSelectedScan, setView: state.setView, historyVersion: state.historyVersion, cachedScans: state.cachedScans, connectionId: state.connectionId, initialized: state.initialized
  })));
  const [items, setItems] = useState<ScanHistoryItem[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectId, setProjectId] = useState('');
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offset = useRef(0);
  const requestVersion = useRef(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let current = true;
    requestVersion.current++;
    offset.current = 0;
    setItems([]);
    if (!initialized || !hasScanCredentials(settings)) return;
    setLoading(true); setError(null);
    void api.scan.history({ projectId: projectId || undefined, offset: 0, limit: PAGE_SIZE }).then((data) => { if (current) { offset.current = data.length; setItems(data); setHasMore(data.length >= PAGE_SIZE); } })
      .catch((err) => { if (current) setError(`Could not refresh remote history. Saved scans remain available. ${err.message}`); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [initialized, connectionId, projectId, refreshVersion, historyVersion]);

  useEffect(() => {
    if (!hasScanCredentials(settings)) return;
    let current = true;
    void api.projects.list().then((data) => { if (current) setProjects(data); }).catch(() => undefined);
    return () => { current = false; };
  }, [connectionId, settings?.cliAuthMode, settings?.hasApiKey]);

  const allItems = useMemo(() => [...new Map([...cachedScans, ...items].map((scan) => [scan.id, scan])).values()].filter((scan) => !projectId || scan.projectId === projectId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [cachedScans, items, projectId]);
  const projectOptions = useMemo(() => [...new Map([...projects.map((project) => [project.id, project.name] as const), ...cachedScans.map((scan) => [scan.projectId, scan.projectName] as const)].map(([id, name]) => [id, { id, name }])).values()].sort((a, b) => a.name.localeCompare(b.name)), [projects, cachedScans]);
  const branches = [...new Set(allItems.map((scan) => scan.branch))].sort();
  const filtered = allItems.filter((scan) => (!branch || scan.branch === branch) && `${scan.projectName} ${scan.branch} ${scan.id} ${Object.entries(scan.tags ?? {}).flat().join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()));

  return <>
    <div className="row between workspace-heading"><div><div className="page-eyebrow">Scan activity</div><h1 className="page-title">History</h1><p className="page-sub">Find scans by project and branch. Saved evidence remains available on this computer.</p></div><button className="btn ghost small" disabled={loading} onClick={() => setRefreshVersion((version) => version + 1)}><RefreshCw size={13} className={loading ? 'spin' : ''} />Refresh</button></div>
    <div className="toolbar"><label className="field">Project<select aria-label="History project" value={projectId} onChange={(event) => { setProjectId(event.target.value); setBranch(''); }}><option value="">All projects</option>{projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="field">Branch<select aria-label="History branch" value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">All branches</option>{branches.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><div className="search-field"><Search size={14} /><input type="search" aria-label="Search scan history" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search loaded scans…" /></div></div>
    {loading && <div className="field-help" role="status">Loading scan history…</div>}{error && <Banner kind="warn">{error}</Banner>}
    {!filtered.length && !loading && <Empty icon={<HistoryIcon size={34} strokeWidth={1.4} />} title={allItems.length ? 'No scans match these filters' : error ? 'No saved history available' : 'No scans in this workspace yet'} hint={allItems.length ? 'Clear the filters to return to loaded history and saved scans.' : error ? 'Remote history could not be loaded. Check the CLI connection in Settings, then refresh.' : 'Run a scan or connect to your Checkmarx project to begin.'} action={allItems.length ? <button className="btn" onClick={() => { setSearch(''); setBranch(''); setProjectId(''); }}>Clear filters</button> : error ? <button className="btn" onClick={() => setView('settings')}>Open CLI settings</button> : <button className="btn" onClick={() => setView(hasScanCredentials(settings) ? 'scan' : 'settings')}>{hasScanCredentials(settings) ? 'Start a scan' : 'Connect account'}</button>} />}
    {filtered.length > 0 && <div className="scroller"><table className="data history-table" aria-label="Scan history"><thead><tr><th>Project</th><th>Branch</th><th>Status</th><th>Created</th><th>Scan ID</th><th aria-label="Actions" /></tr></thead><tbody>{filtered.map((scan) => <tr key={scan.id}><td><div className="history-project">{scan.projectName}</div>{cachedScans.some((cached) => cached.id === scan.id) && <span className="faint">Saved evidence</span>}{scan.tags && <div className="faint">{Object.entries(scan.tags).map(([key, value]) => `${key}:${value}`).join(' · ')}</div>}</td><td className="mono dim">{scan.branch}</td><td><StatusBadge status={scan.status} /></td><td className="dim" title={new Date(scan.createdAt).toLocaleString()}>{timeAgo(scan.createdAt)}</td><td className="faint mono" title={scan.id}>{scan.id.slice(0, 12)}</td><td><div className="row"><button className="btn ghost small" onClick={() => { setSelectedScan(scan.id, null); setView('results'); }}>Results</button>{settings?.baseUrl && <button className="btn ghost small" aria-label={`Open ${scan.projectName} in Checkmarx One`} onClick={() => void api.shell.openExternal(`${settings.baseUrl.replace(/\/+$/, '')}/projects/${scan.projectId}/results?scanIds=${scan.id}`).catch((err) => setError(err.message))}><ExternalLink size={12} /></button>}</div></td></tr>)}</tbody></table></div>}
    <div className="pagination"><span className="faint">{filtered.length} matching scans · search applies to loaded history</span>{hasMore && <button className="btn small" disabled={loading} onClick={async () => { const request = ++requestVersion.current; setLoading(true); setError(null); try { const data = await api.scan.history({ projectId: projectId || undefined, offset: offset.current, limit: PAGE_SIZE }); if (request !== requestVersion.current) return; offset.current += data.length; setItems((current) => [...new Map([...current, ...data].map((scan) => [scan.id, scan])).values()]); setHasMore(data.length >= PAGE_SIZE); } catch (err) { if (request === requestVersion.current) setError(err instanceof Error ? err.message : String(err)); } finally { if (request === requestVersion.current) setLoading(false); } }}>Load 50 older scans</button>}</div>
  </>;
}
