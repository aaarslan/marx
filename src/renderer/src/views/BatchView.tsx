import { useShallow } from 'zustand/react/shallow';
import { hasScanCredentials } from '@shared/types';
import { folderName } from '@shared/path';
import React, { useEffect, useRef, useState } from 'react';
import { Layers, Play, Square } from 'lucide-react';
import type { ProjectInfo, RepositoryBinding, ScanJobState, ScanOptions } from '@shared/types';
import type { WorkspacePlan } from '@shared/workspace';
import { api } from '../api';
import { useApp } from '../store';
import { Banner, StatusBadge } from '../components/ui';
import { Dropzone, ScanOptionsEditor, SeveritySummaryCounts } from '../components/ScanOptions';

export function BatchView() {
  const { settings, jobs: allJobs, batchId, setView, setSelectedScan, setWorkbenchTab } = useApp(useShallow((state) => ({
    settings: state.settings, jobs: state.jobs, batchId: state.batchId, setView: state.setView, setSelectedScan: state.setSelectedScan, setWorkbenchTab: state.setWorkbenchTab
  })));
  const jobs = allJobs.filter((job) => batchId !== null && job.batchId === batchId);
  const [parent, setParent] = useState<string | null>(null);
  const [plan, setPlan] = useState<WorkspacePlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bindings, setBindings] = useState<Record<string, RepositoryBinding>>({});
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, ScanOptions>>({});
  const [namePrefix, setNamePrefix] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const submitLock = useRef(false);
  const folderRequest = useRef(0);
  const [concurrency, setConcurrency] = useState(settings?.defaults.batchConcurrency ?? 2);
  const defaults = settings?.defaults;
  const [options, setOptions] = useState<ScanOptions>({
    scanners: defaults?.scanners ?? ['sast', 'sca'], branch: 'master', sastPreset: defaults?.sastPreset ?? 'Checkmarx Default',
    sastIncremental: false, scaExploitablePath: defaults?.scaExploitablePath ?? false, excludes: defaults?.extraExcludes ?? [], tags: {}
  });

  useEffect(() => {
    let active = true;
    if (hasScanCredentials(settings)) api.projects.list().then((items) => { if (active) setProjects(items); }).catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [settings?.cliPath, settings?.cliConfigPath, settings?.cliAuthMode, settings?.tenant, settings?.baseUrl, settings?.hasApiKey]);

  const pickParent = async (folder: string) => {
    const request = ++folderRequest.current;
    setError(null);
    setDiscovering(true);
    try {
      const next = await api.git.plan(folder);
      const saved: Record<string, RepositoryBinding> = {};
      const mapped = await Promise.all(next.projects.map(async (item) => ({ folder: item.folderPath, binding: await api.bindings.get(item.folderPath).catch(() => null) })));
      if (request !== folderRequest.current) return;
      for (const item of mapped) if (item.binding) saved[item.folder] = item.binding;
      setBindings(saved);
      setTargets(Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, value.projectId])));
      setNames({});
      setOverrides({});
      setParent(next.rootPath);
      setPlan(next);
      setSelected(new Set(next.projects.map((item) => item.folderPath)));
      setNamePrefix(`${folderName(next.rootPath)}-`);
    } catch (cause) { if (request === folderRequest.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (request === folderRequest.current) setDiscovering(false); }
  };

  const running = jobs.some((job) => !job.finishedAt);
  const doneCount = jobs.filter((job) => job.finishedAt).length;
  const newName = (folder: string) => names[folder] ?? `${namePrefix}${plan?.projects.find((item) => item.folderPath === folder)?.relativePath.replaceAll('/', '-') ?? folderName(folder)}`;

  const runAll = async () => {
    if (submitLock.current || running || !selected.size) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const items = [];
      for (const folderPath of selected) {
        const projectId = targets[folderPath];
        const binding = projectId ? await api.bindings.save(folderPath, projectId) : undefined;
        if (binding) setBindings((current) => ({ ...current, [folderPath]: binding }));
        items.push({ folderPath, projectId, projectName: binding?.projectName ?? newName(folderPath).trim(), options: overrides[folderPath] ?? options });
      }
      if (items.some((item) => !item.projectName)) throw new Error('Give each new project a name.');
      await api.scan.runBatch({ items, options, concurrency });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { submitLock.current = false; setSubmitting(false); }
  };

  const jobAction = async (job: ScanJobState, action: 'reconcile' | 'retry') => {
    setError(null);
    try {
      if (action === 'reconcile') await api.workbench.reconcileJob(job.id);
      else { await api.scan.run({ folderPath: job.folderPath, projectId: job.projectId, projectName: job.projectName, options: job.options }); setWorkbenchTab('activity'); setView('workbench'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <>
    <div className="page-eyebrow">Workspace planning</div>
    <h1 className="page-title">Batch scan</h1>
    <p className="page-sub">Discover nested npm, Yarn and pnpm workspaces, map each folder to an exact Checkmarx project, and review its scan options before submitting.</p>
    {!hasScanCredentials(settings) && <Banner kind="warn" action={<button className="btn small" onClick={() => setView('settings')}>Set up connection</button>}>Connect your account to scan multiple projects. You can choose folders first.</Banner>}
    <Dropzone folder={parent} onPick={(folder) => { if (!submitting && !running) void pickParent(folder); }} hint="Workspace root or parent folder containing code projects" />
    {discovering && <p role="status" className="dim">Discovering projects and dependency relationships…</p>}
    {error && <Banner kind="error">{error}</Banner>}
    {plan && <>
      {plan.warnings.map((warning) => <Banner key={warning} kind="warn">{warning}</Banner>)}
      {plan.sharedFiles.length > 0 && <p className="faint">Shared workspace files: {plan.sharedFiles.join(', ')}. Scans upload each selected folder; use a root scan when a package needs lockfiles or build context outside its folder.</p>}
      <div className="row between" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="section-title">{selected.size} of {plan.projects.length} projects selected</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn small" disabled={submitting || running} onClick={() => setSelected(new Set(plan.projects.map((item) => item.folderPath)))}>Select all</button>
          <button className="btn small" disabled={submitting || running} onClick={() => setSelected(new Set())}>Clear</button>
          {plan.impactAvailable && <button className="btn small" disabled={submitting || running} onClick={() => setSelected(new Set(plan.projects.filter((item) => item.affected).map((item) => item.folderPath)))}>Select affected ({plan.projects.filter((item) => item.affected).length})</button>}
        </div>
      </div>
      {plan.impactAvailable && <p className="faint">Affected is a suggestion based on uncommitted Git changes and local package dependencies. Shared changes include every project. Review the selection before scanning.</p>}
      {!plan.projects.length && <div className="card dim">No project folders detected. Choose a workspace root or a parent with package.json, pom.xml, go.mod or another supported project manifest.</div>}
      <fieldset disabled={submitting || running} style={{ border: 0, padding: 0, minWidth: 0 }}>
        {plan.projects.map((item) => <div className="card" key={item.folderPath}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <label className="check"><input type="checkbox" checked={selected.has(item.folderPath)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.folderPath); else next.delete(item.folderPath); return next; })} /><strong>{item.name}</strong><span className="faint mono">{item.relativePath}</span></label>
            {item.affected && <span className="badge" title={item.reasons.join('; ')}>Affected</span>}
          </div>
          {item.reasons.length > 0 && <p className="faint">{item.reasons.join(' · ')}</p>}
          <div className="grid-2" style={{ marginTop: 12 }}>
            <label className="field">Checkmarx project
              <select aria-label={`Project for ${item.relativePath}`} value={targets[item.folderPath] ?? ''} onChange={(event) => setTargets((current) => ({ ...current, [item.folderPath]: event.target.value }))}>
                <option value="">Create a new project</option>
                {bindings[item.folderPath] && !projects.some((entry) => entry.id === bindings[item.folderPath].projectId) && <option value={bindings[item.folderPath].projectId}>{bindings[item.folderPath].projectName} · {bindings[item.folderPath].projectId}</option>}
                {projects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.id}</option>)}
              </select>
            </label>
            {targets[item.folderPath] ? <p className="faint">Exact ID: <span className="mono">{targets[item.folderPath]}</span><br />{bindings[item.folderPath]?.projectId === targets[item.folderPath] ? 'Saved mapping' : 'Mapping will be saved when this batch starts'}</p> : <label className="field">New project name<input value={newName(item.folderPath)} onChange={(event) => setNames((current) => ({ ...current, [item.folderPath]: event.target.value }))} /></label>}
          </div>
          <details style={{ marginTop: 10 }}><summary className="dim">{overrides[item.folderPath] ? 'Custom scan options' : 'Uses shared scan options'}</summary>
            <label className="check" style={{ margin: '12px 0' }}><input type="checkbox" checked={Boolean(overrides[item.folderPath])} onChange={(event) => setOverrides((current) => { const next = { ...current }; if (event.target.checked) next[item.folderPath] = structuredClone(options); else delete next[item.folderPath]; return next; })} />Customize this project</label>
            {overrides[item.folderPath] && <ScanOptionsEditor options={overrides[item.folderPath]} onChange={(patch) => setOverrides((current) => ({ ...current, [item.folderPath]: { ...current[item.folderPath], ...patch } }))} />}
          </details>
        </div>)}
        <div className="card">
          <div className="section-title">Shared scan options</div>
          <div className="grid-2" style={{ marginBottom: 14 }}>
            <label className="field">New project name prefix<input value={namePrefix} onChange={(event) => setNamePrefix(event.target.value)} /></label>
            <label className="field">Parallel scans<input type="number" min={1} max={8} value={concurrency} onChange={(event) => setConcurrency(Math.max(1, Math.min(8, Math.floor(Number(event.target.value)) || 1)))} /></label>
          </div>
          <ScanOptionsEditor options={options} onChange={(patch) => setOptions((current) => ({ ...current, ...patch }))} />
          <p className="faint">Each folder uses its detected Git branch. Full SAST scans are selected initially; review custom options for each package.</p>
        </div>
      </fieldset>
      <div className="row" style={{ margin: '16px 0' }}>
        <button className="btn primary" disabled={!hasScanCredentials(settings) || !selected.size || running || submitting || discovering} onClick={() => void runAll()}><Play size={14} />{submitting ? 'Starting batch…' : `Scan ${selected.size} ${selected.size === 1 ? 'project' : 'projects'}`}</button>
        {running && <button className="btn danger" onClick={() => void Promise.all(jobs.filter((job) => !job.finishedAt).map((job) => api.scan.cancelJob(job))).catch((cause) => setError(String(cause)))}><Square size={12} />Cancel all</button>}
      </div>
    </>}
    {jobs.length > 0 && <>
      <div className="section-title"><Layers size={14} />Batch progress · {doneCount}/{jobs.length} locally settled</div>
      <p className="faint">Unknown outcomes need reconciliation. Retry is available after a confirmed failure or cancellation.</p>
      <div className="scroller"><table className="data batch-table" aria-label="Batch progress"><thead><tr><th>Project</th><th>Status</th><th>Progress</th><th>Findings</th><th aria-label="Actions" /></tr></thead><tbody>
        {jobs.map((job) => <tr key={job.id}>
          <td><div className="batch-project">{job.projectName}</div><div className="faint mono">{folderName(job.folderPath)}</div></td>
          <td><StatusBadge status={job.status} /></td>
          <td className="dim" style={{ maxWidth: 260, overflowWrap: 'anywhere' }}>{job.progress.detail ?? job.progress.phase}</td>
          <td>{job.summary ? <SeveritySummaryCounts summary={job.summary} /> : <span className="faint">Unavailable</span>}</td>
          <td><div className="row" style={{ flexWrap: 'wrap' }}>
            {job.scanId && ['Completed', 'Partial'].includes(job.status) && <button className="btn ghost small" onClick={() => { setSelectedScan(job.scanId!, job.folderPath); setView('results'); }}>Results</button>}
            {job.scanId && job.finishedAt && job.status === 'Unknown' && <button className="btn small" onClick={() => void jobAction(job, 'reconcile')}>Reconcile</button>}
            {job.finishedAt && ['Failed', 'Canceled'].includes(job.status) && !job.error?.includes('unconfirmed') && <button className="btn small" onClick={() => void jobAction(job, 'retry')}>Retry</button>}
          </div></td>
        </tr>)}
      </tbody></table></div>
    </>}
  </>;
}
