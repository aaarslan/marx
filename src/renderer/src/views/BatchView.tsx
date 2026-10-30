import { hasScanCredentials } from '@shared/types';
import { folderName } from '@shared/path';
import React, { useRef, useState } from 'react';
import { Layers, Play, Square } from 'lucide-react';
import type { RepositoryBinding, ScanJobState, ScanOptions } from '@shared/types';
import { api } from '../api';
import { useApp } from '../store';
import { Banner, StatusBadge, Toggle } from '../components/ui';
import { Dropzone, ScanOptionsEditor, SeveritySummaryCounts } from '../components/ScanOptions';

export function BatchView() {
  const { settings, jobs: allJobs, batchId, setView, setSelectedScan } = useApp();
  const jobs = allJobs.filter((job) => batchId !== null && job.batchId === batchId);

  const [parent, setParent] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bindings, setBindings] = useState<Record<string, RepositoryBinding>>({});
  const [namePrefix, setNamePrefix] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const folderRequest = useRef(0);
  const [concurrency, setConcurrency] = useState(settings?.defaults.batchConcurrency ?? 2);

  const defaults = settings?.defaults;
  const [options, setOptions] = useState<ScanOptions>({
    scanners: defaults?.scanners ?? ['sast', 'sca'],
    branch: 'master',
    sastPreset: defaults?.sastPreset ?? 'Checkmarx Default',
    sastIncremental: false,
    scaExploitablePath: defaults?.scaExploitablePath ?? false,
    excludes: defaults?.extraExcludes ?? [],
    tags: {}
  });

  const pickParent = async (path: string) => {
    const request = ++folderRequest.current;
    setError(null);
    try {
      const subs = await api.git.listSubProjects(path);
      if (request !== folderRequest.current) return;
      const saved: Record<string, RepositoryBinding> = {};
      for (const sub of subs) {
        const binding = await api.bindings.get(sub);
        if (binding) saved[sub] = binding;
        if (request !== folderRequest.current) return;
      }
      setBindings(saved);
      setParent(path);
      setCandidates(subs);
      setSelected(new Set(subs));
      setNamePrefix(`${folderName(path)}-`);
    } catch (e) {
      if (request === folderRequest.current) setError(e instanceof Error ? e.message : String(e));
    }
  };

  const running = jobs.length > 0 && jobs.some((j) => !['completed', 'failed', 'canceled'].includes(j.progress.phase));
  const doneCount = jobs.filter((j) => ['completed', 'failed', 'canceled'].includes(j.progress.phase)).length;

  const runAll = async () => {
    if (submitLock.current || running || selected.size === 0) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    const items = [...selected].map((folderPath) => ({
      folderPath,
      projectId: bindings[folderPath]?.projectId,
      projectName: bindings[folderPath]?.projectName ?? `${namePrefix}${folderName(folderPath)}`
    }));
    try { await api.scan.runBatch({ items, options, concurrency }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { submitLock.current = false; setSubmitting(false); }
  };

  const cancelAll = () => void Promise.all(jobs.filter((j) => !j.finishedAt).map((j) => api.scan.cancelJob(j))).catch(() => undefined);

  return (
    <>
<div className="page-eyebrow">Multiple projects</div>
      <h1 className="page-title">Batch scan</h1>
      <p className="page-sub">
        Point at the folder holding your micro frontends — Marx scans every subproject as its own
        Checkmarx One project, in parallel.
      </p>

      {!hasScanCredentials(settings) && (
        <Banner kind="warn" action={<button className="btn small" onClick={() => setView('settings')}>Set up connection</button>}>Connect your account to scan multiple projects. You can choose folders first.</Banner>
      )}

      <Dropzone folder={parent} onPick={(p) => void pickParent(p)} hint="Parent folder containing multiple project folders" />
      {error && <Banner kind="error">{error}</Banner>}

      {parent && (
        <>
          <p className="faint">Saved mappings use the exact project ID. Other folders create new projects; existing names require a mapping in Scan first.</p>
          <div className="section-title">
            Projects found ({selected.size}/{candidates.length} selected)
          </div>
          <div className="card" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {candidates.length === 0 && (
              <div className="dim">No project folders detected (looked for package.json, pom.xml, go.mod, …).</div>
            )}
            {candidates.map((c) => (
              <label className="check" key={c} style={{ padding: '5px 0' }}>
                <input
                  type="checkbox"
                  checked={selected.has(c)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(c);
                    else next.delete(c);
                    setSelected(next);
                  }}
                />
                <span className="mono" style={{ fontSize: 12 }}>{folderName(c)}</span>
                <span className="faint mono" style={{ fontSize: 10.5 }}>{c} → {bindings[c] ? `${bindings[c].projectName} (${bindings[c].projectId})` : `Create ${namePrefix}${folderName(c)}`}</span>
              </label>
            ))}
          </div>

          <div className="card">
            <div className="grid-2" style={{ marginBottom: 14 }}>
              <label className="field">
                Project name prefix
                <input
                  type="text"
                  value={namePrefix}
                  onChange={(e) => setNamePrefix(e.target.value)}
                  placeholder="e.g. shop-"
                />
              </label>
              <label className="field">
                Parallel scans
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Math.max(1, Math.min(8, Number(e.target.value) || 2)))}
                  style={{ width: 80 }}
                />
              </label>
            </div>
            <ScanOptionsEditor options={options} onChange={(patch) => setOptions((o) => ({ ...o, ...patch }))} />
            <div style={{ marginTop: 6 }}>
              <Toggle
                checked={!options.sastIncremental}
                onChange={(full) => setOptions((o) => ({ ...o, sastIncremental: !full }))}
                label="Force full SAST scans"
                sub="recommended for first-time batch runs — incremental needs prior scans"
              />
            </div>
          </div>

          <div className="row" style={{ margin: '16px 0' }}>
            <button
              className="btn primary"
              disabled={!hasScanCredentials(settings) || selected.size === 0 || running || submitting}
              onClick={() => void runAll()}
            >
              <Play size={14} />
              {submitting ? 'Starting batch…' : `Scan ${selected.size} ${selected.size === 1 ? 'project' : 'projects'}`}
            </button>
            {running && (
              <button className="btn danger" onClick={cancelAll}>
                <Square size={12} /> Cancel all
              </button>
            )}
          </div>
        </>
      )}

      {jobs.length > 0 && (
        <>
          <div className="section-title">
            <Layers size={14} /> Batch progress — {doneCount}/{jobs.length} finished
          </div>
          <div className="scroller" style={{ maxHeight: 'calc(100vh - 420px)' }}>
            <table className="data batch-table" aria-label="Batch progress">
              <thead>
                <tr>
                  <th style={{ width: '25%' }}>Project</th>
                  <th style={{ width: '15%' }}>Status</th>
                  <th style={{ width: '22%' }}>Phase</th>
                  <th style={{ width: '25%' }}>Findings</th>
                  <th style={{ width: '13%' }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <JobRow key={j.id} job={j} onOpen={() => {
                    if (j.scanId) {
                      setSelectedScan(j.scanId, j.folderPath);
                      setView('results');
                    }
                  }} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function JobRow({ job, onOpen }: { job: ScanJobState; onOpen: () => void }) {
  return (
    <tr>
      <td>
        <div className="batch-project">{job.projectName}</div>
        <div className="faint mono" style={{ fontSize: 10.5 }}>{folderName(job.folderPath)}</div>
      </td>
      <td>
        <StatusBadge status={job.status} />
      </td>
      <td className="dim" style={{ fontSize: 12 }}>
        {job.progress.phase}
        {job.progress.detail ? ` · ${job.progress.detail}` : ''}
      </td>
      <td>
        {job.summary ? <SeveritySummaryCounts summary={job.summary} /> : <span className="faint">—</span>}
      </td>
      <td>
        {job.scanId && (
          <button className="btn ghost small" onClick={onOpen} disabled={job.progress.phase !== 'completed'}>
            Results
          </button>
        )}
      </td>
    </tr>
  );
}
