import { useShallow } from 'zustand/react/shallow';
import { hasScanCredentials } from '@shared/types';
import { folderName } from '@shared/path';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Zap, FolderOpen, Settings2, ShieldCheck } from 'lucide-react';
import type { GitInfo, ProjectInfo, ScanJobState, ScanOptions, ScannerType } from '@shared/types';
import { api, commandKey } from '../api';
import { useApp } from '../store';
import { Banner } from '../components/ui';
import { Dropzone, ProgressCard, ScanOptionsEditor } from '../components/ScanOptions';

export function ScanView() {
  const { settings, jobs, applyEvent, setSelectedScan, setView, menuAction, menuActionId, init } = useApp(useShallow((state) => ({
    settings: state.settings,
    jobs: state.jobs,
    applyEvent: state.applyEvent,
    setSelectedScan: state.setSelectedScan,
    setView: state.setView,
    menuAction: state.menuAction,
    menuActionId: state.menuActionId,
    init: state.init
  })));

  const [folder, setFolder] = useState<string | null>(null);
  const [git, setGit] = useState<GitInfo | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectMode, setProjectMode] = useState<'existing' | 'new'>('existing');
  const [projectId, setProjectId] = useState<string>('');
  const [boundProjectId, setBoundProjectId] = useState('');
  const [projectName, setProjectName] = useState<string>('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const defaults = settings?.defaults;
  const [options, setOptions] = useState<ScanOptions>({
    scanners: defaults?.scanners ?? ['sast', 'sca'],
    branch: 'master',
    sastPreset: defaults?.sastPreset ?? 'Checkmarx Default',
    sastIncremental: defaults?.sastIncremental ?? true,
    scaExploitablePath: defaults?.scaExploitablePath ?? false,
    excludes: defaults?.extraExcludes ?? [],
    tags: {}
  });

  // current job for this view = most recent non-batch job
  const currentJob = useMemo(() => jobs.find((j) => j.folderPath === folder), [jobs, folder]);

  // apply saved defaults once (first settings load) — later settings refreshes
  // shouldn't wipe the user's in-progress edits in this view
  const appliedDefaults = useRef(false);
  useEffect(() => {
    if (defaults && !appliedDefaults.current) {
      appliedDefaults.current = true;
      setOptions((o) => ({
        ...o,
        scanners: defaults.scanners,
        sastPreset: defaults.sastPreset,
        sastIncremental: defaults.sastIncremental,
        excludes: defaults.extraExcludes,
        scaExploitablePath: defaults.scaExploitablePath
      }));
    }
  }, [defaults]);

  useEffect(() => {
    if (hasScanCredentials(settings)) {
      api.projects
        .list()
        .then((ps) => {
          setProjects(ps);
          if (ps.length === 0) {
            setProjectMode('new');
          }
        })
        .catch((error) => { setProjects([]); setError(error instanceof Error ? error.message : String(error)); });
    }
  }, [settings?.cliAuthMode, settings?.hasApiKey, settings?.cliPath, settings?.cliConfigPath]);

  const folderRequest = useRef(0);
  const pickFolder = async (path: string) => {
    const request = ++folderRequest.current;
    setError(null);
    let info: GitInfo;
    try { info = await api.git.info(path); } catch (e) {
      if (request === folderRequest.current) setError(e instanceof Error ? e.message : 'Could not open that folder.');
      return;
    }
    if (request !== folderRequest.current) return;
    setFolder(path);
    setGit(info);
    setOptions((o) => ({ ...o, branch: info?.branch ?? 'master' }));
    setProjectName((prev) => prev || info?.repoName || folderName(path) || 'project');
    setProjectId('');
    setBoundProjectId('');
    try {
      const binding = await api.bindings.get(path);
      if (request !== folderRequest.current) return;
      if (binding) {
        setProjectMode('existing');
        setProjectId(binding.projectId);
        setBoundProjectId(binding.projectId);
      }
    } catch (e) { if (request === folderRequest.current) setError(e instanceof Error ? e.message : String(e)); }
  };

  const canRun =
    Boolean(folder) &&
    options.scanners.length > 0 &&
    (projectMode === 'new' ? projectName.trim().length > 0 : Boolean(projectId)) &&
    Boolean(hasScanCredentials(settings));

  const running =
    currentJob != null &&
    !['completed', 'failed', 'canceled'].includes(currentJob.progress.phase);

  const run = async () => {
    if (!folder || !canRun || running || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
    if (projectMode === 'existing') {
      await api.bindings.save(folder, projectId);
      setBoundProjectId(projectId);
    }
    const job = await api.scan.run({
      folderPath: folder,
      projectName: projectMode === 'new' ? projectName.trim() : projects.find((p) => p.id === projectId)?.name ?? projectName,
      projectId: projectMode === 'existing' ? projectId : undefined,
      options
    });
    applyEvent({ kind: 'job-updated', job });
    void init();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { submitLock.current = false; setSubmitting(false); }
  };

  const viewResults = (job: ScanJobState) => {
    setSelectedScan(job.scanId ?? null, job.folderPath);
    setView('results');
  };

  const storyJobId = useRef<string | null>(null);
  const runStoryCheck = async () => {
    if (!folder || !canRun || running || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
    if (projectMode === 'existing') {
      await api.bindings.save(folder, projectId);
      setBoundProjectId(projectId);
    }
    const job = await api.scan.run({
      folderPath: folder,
      projectName:
        projectMode === 'new'
          ? projectName.trim()
          : projects.find((p) => p.id === projectId)?.name ?? projectName,
      projectId: projectMode === 'existing' ? projectId : undefined,
      options: {
        ...options,
        scanners: Array.from(new Set([...options.scanners, 'sast' as ScannerType, 'sca' as ScannerType])),
        sastIncremental: false
      }
    });
    storyJobId.current = job.id;
    applyEvent({ kind: 'job-updated', job });
    void init();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { submitLock.current = false; setSubmitting(false); }
  };
  useEffect(() => {
    const id = storyJobId.current;
    if (!id) return;
    const job = jobs.find((j) => j.id === id);
    if (job?.progress.phase === 'completed' && job.scanId) {
      storyJobId.current = null;
      setSelectedScan(job.scanId, job.folderPath, true);
      setView('results');
    }
  }, [jobs, setSelectedScan, setView]);

  // ⌘O opens the folder picker, ⌘R kicks off the scan (routed via the store)
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (menuActionId === 0 || !menuAction) return;
    if (menuAction === 'open-folder') {
      void api.dialog.selectFolder().then((f) => f && void pickFolder(f));
    } else if (menuAction === 'run-scan') {
      runRef.current();
    }
    // re-run only on a new menu action
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuActionId]);

  return (
    <>
<div className="page-eyebrow">Source security</div>
      <h1 className="page-title">Scan a project</h1>
      <p className="page-sub">
        Choose a folder and Marx runs the official Checkmarx CLI for you. Source is uploaded to Checkmarx One for analysis.
      </p>

      {!hasScanCredentials(settings) && (
        <Banner kind="warn" action={<button className="btn small" onClick={() => setView('settings')}>Set up connection</button>}>
          Connect your Checkmarx One account to run a scan. You can choose a source folder first.
        </Banner>
      )}

      <Dropzone folder={folder} onPick={(p) => void pickFolder(p)} hint=".git, dependencies, and build output are excluded by default" />

      {error && <Banner kind="error">{error}</Banner>}

      {!folder && settings && settings.recentFolders.length > 0 && (
        <div className="row" style={{ margin: '12px 0 0', flexWrap: 'wrap', gap: 6 }}>
          <span className="faint" style={{ fontSize: 11 }}>Recent:</span>
          {settings.recentFolders.map((f) => (
            <button
              type="button"
              key={f}
              className="chip clickable"
              title={f}
              onClick={() => void pickFolder(f)}
            >
              <FolderOpen size={12} />{folderName(f)}
            </button>
          ))}
        </div>
      )}

      {!folder && (
        <div className="workflow-guide" aria-label="How scanning works">
          <div><span className="guide-icon"><FolderOpen size={17} /></span><strong>Choose source</strong><p>A service, app, or repository on your computer.</p></div>
          <div><span className="guide-icon"><Settings2 size={17} /></span><strong>Configure the scan</strong><p>Pick a project, branch, and scan engines.</p></div>
          <div><span className="guide-icon"><ShieldCheck size={17} /></span><strong>Review and resolve</strong><p>Explore findings or compare with a baseline.</p></div>
        </div>
      )}

      {folder && (
        <>
          <div className="section-title">Project</div>
          <div className="card">
            <div className="row" style={{ marginBottom: 12, gap: 6 }}>
              {(['existing', 'new'] as const).map((m) => (
                <button
                  key={m}
                  className={`btn small ${projectMode === m ? 'selected' : ''}`}
                  aria-pressed={projectMode === m}
                  onClick={() => setProjectMode(m)}
                >
                  {m === 'existing' ? 'Existing project' : 'New project'}
                </button>
              ))}
            </div>
            <div className="grid-2">
              {projectMode === 'existing' ? (
                <label className="field">Checkmarx One project
                  <select aria-label="Checkmarx One project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="" disabled>{projects.length ? 'Choose a project' : 'No projects loaded'}</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              ) : (
                <label className="field">Project name
                  <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="my-service" />
                </label>
              )}
              <label className="field">Branch
                <input type="text" value={options.branch} onChange={(e) => setOptions((o) => ({ ...o, branch: e.target.value }))} />
                {git && !git.hasGit && <span className="faint">No Git branch detected</span>}
              </label>
            </div>
          </div>

          <p className="faint" role="status">{projectMode === 'new'
            ? 'A new Checkmarx project will be created. Existing names must be selected explicitly.'
            : projectId ? `${boundProjectId === projectId ? 'Saved mapping' : 'Run scan will save this mapping'}: ${folder} → ${projects.find((p) => p.id === projectId)?.name ?? projectId} (${projectId}).` : 'Choose the Checkmarx project for this repository. Folder names never select a project.'}</p>
          <div className="card">
            <ScanOptionsEditor
              options={options}
              onChange={(patch) => setOptions((o) => ({ ...o, ...patch }))}
            />
          </div>

          <div className="scan-actions">
            <button className="btn primary" disabled={!canRun || running || submitting} onClick={() => void run()}>
              <Play size={14} />
              {submitting ? 'Starting…' : running ? 'Scanning…' : 'Run scan'}<kbd>{commandKey}R</kbd>
            </button>
            <button
              className="btn"
              disabled={!canRun || running || submitting}
              onClick={() => void runStoryCheck()}
              title="Run full SAST + SCA, then choose a baseline explicitly in Results"
            >
              <Zap size={14} />
              Story check
            </button>
            {!hasScanCredentials(settings) && <span className="faint">Connect your account in Settings to start.</span>}
            {!options.sastIncremental && options.scanners.includes('sast') && (
              <span className="faint">full SAST scan — first scan on a project should be full</span>
            )}
          </div>

          {currentJob && (
            <>
              <div className="section-title">Live status</div>
              <ProgressCard
                job={currentJob}
                onCancel={() => void api.scan.cancelJob(currentJob).catch(() => undefined)}
                onViewResults={() => viewResults(currentJob)}
              />
              <ScanLog jobId={currentJob.id} />
            </>
          )}
        </>
      )}
    </>
  );
}

function ScanLog({ jobId }: { jobId: string }) {
  const lines = useApp((state) => state.logs[jobId]);
  if (!lines?.length) return null;
  return (
    <div className="log-box" role="region" aria-label="Scan log" tabIndex={0}>
      {lines.slice(-12).map((line, index) => <div key={index}>{line}</div>)}
    </div>
  );
}
