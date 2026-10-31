import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IPC } from '@shared/ipc';
import type {
  GitInfo,
  ProjectInfo,
  ScanHistoryItem,
  ScanJobState,
  ScanOptions,
  Settings,
  TriageRequest,
  TestConnectionResult
} from '@shared/types';
import { MAX_PROMPT_EXPORT_BYTES } from '@shared/remediation';
import { CxCliClient } from './cxone/cli';
import { compareScans } from '@shared/comparison';
import type { FindingQuery, WorkspaceState } from '@shared/workbench';
import { WorkbenchStore } from './workbenchStore';
import { WorkbenchService } from './workbenchService';
import { captureProvenance } from './provenance';
import { getApiKey, loadSettings, saveSettings, setApiKey as persistApiKey } from './settings';
import { getGitInfo, listSubProjects } from './gitInfo';
import { planWorkspace } from './workspacePlan';
import { ScanRunner } from './scanRunner';
import { BatchRunner } from './batchRunner';
import { SourceFolders } from './sourceFolders';
import { RepositoryBindings } from './repositoryBindings';
import { readSourceSnippet } from './sourceSnippet';
import { buildCsv, buildJson, safeFileName, type ExportPayload } from './exportFindings';

export interface IpcContext {
  getWindow: () => BrowserWindow | null;
}

let batchRunner: BatchRunner | null = null;

function notify(ctx: IpcContext, title: string, body: string, scan?: { scanId: string; folderPath: string }): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.on('click', () => {
    // clicking a completed-scan notification opens its results directly
    if (scan) {
      ctx.getWindow()?.webContents.send(IPC.scanEvent, { kind: 'open-results', scanId: scan.scanId, folderPath: scan.folderPath });
    }
    ctx.getWindow()?.show();
  });
  n.show();
}

function recordRecentFolder(folder: string): void {
  const s = loadSettings();
  const next = [folder, ...s.recentFolders.filter((f) => f !== folder)].slice(0, 8);
  saveSettings({ recentFolders: next });
}

export function getClient(): CxCliClient {
  const settings = loadSettings();
  return new CxCliClient({
    executable: settings.cliPath, configPath: settings.cliConfigPath, authMode: settings.cliAuthMode,
    apiKey: settings.cliAuthMode === 'marx' ? getApiKey() : undefined,
    baseUrl: settings.baseUrl, tenant: settings.tenant
  });
}

export function registerIpcHandlers(ctx: IpcContext): void {
  const pushEvent = (payload: unknown) => {
    ctx.getWindow()?.webContents.send(IPC.scanEvent, payload);
  };

  const store = new WorkbenchStore(path.join(app.getPath('userData'), 'workbench.sqlite'));
  const bindings = new RepositoryBindings(path.join(app.getPath('userData'), 'repository-bindings.json'));
  const folders = new SourceFolders([...loadSettings().recentFolders, ...store.jobs().map((job) => job.folderPath), ...bindings.folders()]);
  const jobPhase = new Map<string, string>();
  const mappedJobs = new Set<string>();

  const jobs = new Map<string, ScanJobState>();
  let cachedClient: CxCliClient | null = null;
  const client = () => cachedClient ??= getClient();
  const workbench = new WorkbenchService(store, client);
  const persistenceWarnings = new Set<string>();
  const warnPersistence = (jobId: string, error: unknown) => {
    if (persistenceWarnings.has(jobId)) return;
    persistenceWarnings.add(jobId);
    pushEvent({ kind: 'log', jobId, line: `Local history could not be saved: ${String(error)}. Keep Marx open until this scan settles.` });
  };
  const persistProgress = (job: ScanJobState) => {
    try { store.saveJob(job); } catch (error) { warnPersistence(job.id, error); }
  };
  const interrupted: ScanJobState[] = [];
  for (const job of store.jobs()) {
    if (job.finishedAt) continue;
    job.monitoringStatus = 'stopped';
    job.status = 'Unknown';
    job.progress = { phase: 'failed', detail: 'Local monitoring was interrupted.' };
    job.error = job.scanId ? 'Reconcile this scan to restore its remote status.' : 'Submission outcome is unknown. Check Checkmarx One before starting another scan.';
    job.finishedAt = Date.now();
    persistProgress(job);
    if (job.scanId) interrupted.push(job);
  }
  app.once('will-quit', () => store.close());

  const runner = new ScanRunner(client, {
    onJobUpdated: (job) => {
      persistProgress(job);
      if (job.progress.phase === 'queued' && job.projectId && job.connectionId && !mappedJobs.has(job.id)) {
        mappedJobs.add(job.id);
        try { bindings.save({ folderPath: job.folderPath, projectId: job.projectId, projectName: job.projectName, connectionId: job.connectionId }); }
        catch (error) { pushEvent({ kind: 'log', jobId: job.id, line: `Could not save repository mapping: ${error instanceof Error ? error.message : String(error)}` }); }
      }
      if (job.finishedAt) { mappedJobs.delete(job.id); jobs.delete(job.id); }
      else if (!jobs.has(job.id)) jobs.set(job.id, job);
      // macOS notification when a scan settles (completed / failed / canceled)
      const prev = jobPhase.get(job.id);
      const phase = job.progress.phase;
      if (job.finishedAt) jobPhase.delete(job.id);
      else jobPhase.set(job.id, phase);
      const settled = phase === 'completed' || phase === 'failed' || phase === 'canceled';
      if (settled && prev !== undefined && prev !== phase) {
        if (phase === 'completed') {
          notify(ctx, job.status === 'Partial' ? 'Scan partially completed' : 'Scan completed', `${job.projectName} (${job.branch}): ${job.status === 'Partial' ? 'some engines did not finish.' : job.summary ? 'results are available.' : 'summary unavailable; open the results.'}`,
            job.scanId ? { scanId: job.scanId, folderPath: job.folderPath } : undefined);
        } else if (phase === 'failed') {
          notify(ctx, job.status === 'Unknown' ? 'Scan status needs attention' : 'Scan failed', `${job.projectName}: ${job.error ?? 'unknown error'}`);
        } else {
          notify(ctx, job.status === 'Canceled' ? 'Scan canceled' : 'Monitoring stopped', `${job.projectName}: ${job.status === 'Canceled' ? 'cancellation confirmed.' : 'remote cancellation is unconfirmed.'}`);
        }
      }
      pushEvent({ kind: 'job-updated', job });
    },
    onLog: (jobId, line) => {
      try { store.appendLog(jobId, line); } catch (error) { warnPersistence(jobId, error); }
      pushEvent({ kind: 'log', jobId, line });
    }
  });

  let preparingBatch = false;
  const ensureBatchRunner = () => {
    if (!batchRunner) {
      batchRunner = new BatchRunner(runner, (batchJobs) => {
        for (const job of batchJobs) {
          persistProgress(job);
          if (job.finishedAt) jobs.delete(job.id);
          else if (!jobs.has(job.id)) jobs.set(job.id, job);
        }
        pushEvent({ kind: 'job-list', jobs: batchJobs });
      }, (prepared) => store.saveJobs(prepared));
    }
    return batchRunner;
  };

  const handle = (channel: string, fn: (...args: never[]) => unknown | Promise<unknown>) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        const contents = ctx.getWindow()?.webContents;
        if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) throw new Error('Untrusted IPC sender.');
        return { ok: true, data: await fn(...(args as never[])) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    });
  };

  // ---- settings ------------------------------------------------------------
  handle(IPC.settingsGet, () => loadSettings());
  handle(IPC.settingsSave, (settings: Partial<Settings>) => {
    cachedClient = null;
    const current = loadSettings();
    return saveSettings({
      cliPath: settings.cliPath ?? current.cliPath,
      cliConfigPath: settings.cliConfigPath ?? current.cliConfigPath,
      cliAuthMode: settings.cliAuthMode ?? current.cliAuthMode,
      baseUrl: settings.baseUrl ?? current.baseUrl,
      tenant: settings.tenant ?? current.tenant,
      defaults: settings.defaults ?? current.defaults
    });
  });
  handle(IPC.settingsSetApiKey, (key: string) => {
    persistApiKey(key);
    cachedClient = null;
    return loadSettings();
  });
  handle(IPC.testConnection, async (): Promise<TestConnectionResult> => {
    return client().testConnection();
  });

  // ---- dialogs / fs --------------------------------------------------------
  handle(IPC.selectFolder, async (): Promise<string | null> => {
    const win = ctx.getWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : await folders.grant(result.filePaths[0]);
  });

  handle(IPC.selectCli, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(ctx.getWindow()!, { properties: ['openFile'], title: 'Select the official Checkmarx CLI executable' });
    return result.canceled ? null : result.filePaths[0];
  });

  handle(IPC.authorizeFolder, (folder: string) => folders.grant(folder));

  handle(IPC.readSourceFile, async (folder: string, relativePath: string, line?: number, projectId?: string) => {
    const canonical = await folders.require(folder);
    const binding = bindings.get(canonical, await workbench.localConnection());
    if (!projectId || binding?.projectId !== projectId) throw new Error('Link this repository to the selected Checkmarx project before reading source.');
    return readSourceSnippet(canonical, relativePath, line);
  });

  handle(IPC.openInEditor, async (folder: string, relativePath: string, line: number, projectId: string, editor: string) => {
    if (!['code', 'cursor'].includes(editor)) throw new Error('Choose a supported editor.');
    const canonical = await folders.require(folder);
    const binding = bindings.get(canonical, await workbench.localConnection());
    if (binding?.projectId !== projectId) throw new Error('Link this repository to the selected project first.');
    const snippet = await readSourceSnippet(canonical, relativePath, line);
    const target = new URL(`${editor === 'code' ? 'vscode' : 'cursor'}://file/`);
    target.pathname = `${path.join(canonical, snippet.path).replaceAll('\\', '/')}:${Math.max(1, Math.min(snippet.totalLines, Math.floor(line) || 1))}`;
    await shell.openExternal(target.toString());
  });

  handle(IPC.sourceStatus, async (folder: string, scanId: string) => {
    const canonical = await folders.require(folder);
    const page = await workbench.results(scanId);
    const original = page.provenance;
    if (!original || original.source.folderPath !== canonical || !original.source.fingerprint) return { matches: null, message: 'This scan has no matching source fingerprint. The displayed code is the current checkout.' };
    const current = await captureProvenance(canonical, original.options, original.connectionId, original.cliVersion);
    if (!current.source.fingerprint) return { matches: null, message: current.source.captureWarning ?? 'Current source could not be fingerprinted.' };
    const matches = current.source.fingerprint === original.source.fingerprint;
    return { matches, message: matches ? 'The recorded source fingerprint matches this checkout. The scan archive itself was not preserved.' : 'Local source changed after the recorded scan. File locations may have moved.' };
  });

  handle(IPC.gitInfo, async (folder: string): Promise<GitInfo> => getGitInfo(await folders.require(folder)));
  handle(IPC.listSubfolders, async (parent: string): Promise<string[]> => {
    const children = listSubProjects(await folders.require(parent));
    return Promise.all(children.map((folder) => folders.grant(folder)));
  });
  handle(IPC.workspacePlan, async (parent: string) => {
    const plan = await planWorkspace(await folders.require(parent));
    await Promise.all(plan.projects.map((item) => folders.grant(item.folderPath)));
    return plan;
  });

  handle(IPC.openExternal, (url: string) => {
    if (/^https:\/\//.test(url)) {
      void shell.openExternal(url);
    }
  });

  // ---- projects ------------------------------------------------------------
  handle(IPC.bindingGet, async (folder: string) => bindings.get(await folders.require(folder), await client().connectionId()));
  handle(IPC.bindingSave, async (folder: string, projectId: string) => {
    const folderPath = await folders.require(folder);
    const selected = client();
    const connectionId = await selected.connectionId();
    const project = await selected.getProject(projectId);
    if (selected !== client() || connectionId !== await selected.connectionId()) throw new Error('CLI configuration changed. Choose the project again.');
    recordRecentFolder(folderPath);
    return bindings.save({ folderPath, projectId: project.id, projectName: project.name, connectionId });
  });

  const validateMapping = async (folder: string, projectId?: string, projectName?: string) => {
    const connectionId = await client().connectionId();
    if (projectId) {
      const binding = bindings.get(folder, connectionId);
      if (binding?.projectId !== projectId || binding.projectName !== projectName) throw new Error('Confirm the repository-to-project mapping before scanning.');
    }
    return connectionId;
  };

  handle(IPC.projectsList, async (): Promise<ProjectInfo[]> => {
    const { projects } = await client().listProjects();
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      mainBranch: p.mainBranch ?? 'master',
      tags: p.tags ?? {}
    }));
  });

  // ---- scans ---------------------------------------------------------------
  const runScan = async (input: { folderPath: string; projectName: string; projectId?: string; options: ScanOptions }, beforeStart?: (job: ScanJobState) => void) => {
    input.folderPath = await folders.require(input.folderPath);
    recordRecentFolder(input.folderPath);
    const connectionId = await validateMapping(input.folderPath, input.projectId, input.projectName);
    const selected = client();
    const { version } = await selected.preflight();
    const provenance = await captureProvenance(input.folderPath, input.options, connectionId, version);
    if (selected !== client() || await selected.connectionId() !== connectionId) throw new Error('Connection changed before submission. Review the project mapping.');
    const job = runner.newJob(input);
    job.connectionId = connectionId;
    job.provenance = provenance;
    if (beforeStart) beforeStart(job);
    else store.saveJob(job);
    jobs.set(job.id, job);
    void runner.run(job);
    return job;
  };
  handle(IPC.scanRun, (input: Parameters<typeof runScan>[0]) => runScan(input));

  handle(IPC.scanRunBatch, async (input: {
    items: { folderPath: string; projectName: string; projectId?: string; options?: ScanOptions }[];
    options: ScanOptions;
    concurrency: number;
  }) => {
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 200) throw new Error('Choose between 1 and 200 projects for a batch.');
    const b = ensureBatchRunner();
    // each subproject may be on its own branch — detect per folder
    if (preparingBatch || b.isRunning()) throw new Error('A batch is already running.');
    preparingBatch = true;
    try {
      const selected = client();
      const startingConnection = await selected.connectionId();
      const { version } = await selected.preflight();
      const foldersSeen = new Set<string>();
      const inputs = [];
      for (const i of input.items) {
        const folderPath = await folders.require(i.folderPath);
        if (foldersSeen.has(folderPath)) throw new Error('The batch contains the same folder more than once.');
        foldersSeen.add(folderPath);
        const git = await getGitInfo(folderPath);
        const connectionId = await validateMapping(folderPath, i.projectId, i.projectName);
        if (connectionId !== startingConnection) throw new Error('Connection changed while preparing the batch. Review its project mappings.');
        const options = { ...(i.options ?? input.options), branch: git.branch || (i.options ?? input.options).branch };
        const provenance = await captureProvenance(folderPath, options, connectionId, version);
        inputs.push({ ...i, folderPath, connectionId, options, provenance });
      }
      if (selected !== client() || await selected.connectionId() !== startingConnection) throw new Error('Connection changed before batch submission. Review its project mappings.');
      const batch = b.startAll(inputs, input.concurrency);
      void batch.completion.catch((error) => batch.jobs.forEach((job) => warnPersistence(job.id, error)));
      return batch.jobs;
    } finally { preparingBatch = false; }
  });

  handle(IPC.scanCancelJob, async (job: ScanJobState) => {
    const current = jobs.get(job.id);
    if (current) await runner.cancelJob(current);
  });

  handle(IPC.scanJobs, async () => store.jobs(await workbench.localConnection()));

  handle(IPC.scanHistory, async (options: { projectId?: string; offset?: number; limit?: number } = {}): Promise<ScanHistoryItem[]> => {
    const selected = client();
    const connectionId = await workbench.connection();
    const { scans } = await selected.listScans({ ...options, offset: Math.max(0, Math.floor(options.offset ?? 0)), limit: Math.max(1, Math.min(200, Math.floor(options.limit ?? 50))) });
    if (selected !== client() || await selected.connectionId() !== connectionId) throw new Error('Connection changed while loading scan history. Refresh the workspace.');
    const localJobs = new Map(store.jobs(connectionId).filter((job) => job.scanId).map((job) => [job.scanId, job]));
    return scans.map((s) => ({
      id: s.id,
      projectId: s.projectId ?? '',
      projectName: s.projectName ?? '',
      branch: s.branch ?? '',
      status: (s.status as ScanHistoryItem['status']) ?? 'Unknown',
      createdAt: s.createdAt ?? '',
      updatedAt: s.updatedAt ?? '',
      sourceOrigin: s.sourceOrigin,
      tags: s.tags,
      provenance: localJobs.get(s.id)?.provenance
    }));
  });

  handle(IPC.scanSummary, async (scanId: string) => client().getScanSummary(scanId));

  // ---- results -------------------------------------------------------------
  handle(IPC.resultsGet, (scanId: string, options?: { refresh?: boolean; requestId?: string }) => workbench.results(scanId, options));
  handle(IPC.resultsCancel, (requestId: string) => workbench.cancel(requestId));
  handle(IPC.resultsCompare, async (baselineId: string, currentId: string) => compareScans(await workbench.results(baselineId), await workbench.results(currentId)));
  handle(IPC.resultsQuery, async (scanId: string, query: FindingQuery) => {
    const connectionId = await workbench.localConnection();
    if (!store.hasSnapshot(connectionId, scanId)) await workbench.results(scanId);
    return store.queryFindings(connectionId, scanId, query);
  });

  handle(IPC.resultsTriage, async (req: TriageRequest) => {
    const connectionId = await workbench.connection();
    if (req.finding.connectionId !== connectionId) throw new Error('Reload this finding in the current connection before changing triage.');
    const { comment } = req;
    if (!comment.trim()) {
      throw new Error('A comment is required when changing a result state.');
    }
    await client().triage(req);
    return true;
  });

  // ---- export ---------------------------------------------------------------
  const requirePrompt = (text: string) => {
    if (typeof text !== 'string' || !text.trim()) throw new Error('The remediation prompt is empty.');
    if (Buffer.byteLength(text, 'utf8') > MAX_PROMPT_EXPORT_BYTES) throw new Error('This prompt exceeds 8 MiB. Select fewer findings and try again.');
    return text;
  };
  handle(IPC.remediationCopy, (text: string) => { clipboard.writeText(requirePrompt(text)); });
  let savingPrompt = false;
  handle(IPC.remediationSave, async (input: { text: string; suggestedName: string }): Promise<string | null> => {
    if (savingPrompt) throw new Error('A prompt save dialog is already open.');
    const text = requirePrompt(input.text);
    if (typeof input.suggestedName !== 'string') throw new Error('Choose a valid prompt filename.');
    savingPrompt = true;
    try {
      const result = await dialog.showSaveDialog(ctx.getWindow()!, {
        title: 'Save remediation prompt',
        defaultPath: path.join(app.getPath('downloads'), `${safeFileName(input.suggestedName)}.md`),
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (result.canceled || !result.filePath) return null;
      await fs.promises.writeFile(result.filePath, text, { encoding: 'utf8', mode: 0o600 });
      return result.filePath;
    } finally { savingPrompt = false; }
  });

  handle(IPC.resultsExport, async (payload: ExportPayload): Promise<string> => {
    const stamp = new Date().toISOString().replace(/[:.T]/g, '-');
    const name = `marx-${safeFileName(payload.label)}-${stamp}.${payload.format}`;
    const target = path.join(app.getPath('downloads'), name);
    const content =
      payload.format === 'csv'
        ? buildCsv(payload.findings)
        : buildJson(payload.findings);
    fs.writeFileSync(target, content, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
    shell.showItemInFolder(target);
    return target;
  });

  const saveEvidence = async (title: string, filename: string, content: string, extension: string): Promise<string | null> => {
    const result = await dialog.showSaveDialog(ctx.getWindow()!, { title, defaultPath: path.join(app.getPath('downloads'), filename), filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.promises.writeFile(result.filePath, content, { encoding: 'utf8', mode: 0o600 });
    return result.filePath;
  };

  handle(IPC.resultsSarif, async (scanId: string) => {
    await workbench.connection();
    const content = await client().reportSarif(scanId);
    return saveEvidence('Export Checkmarx SARIF', `marx-${safeFileName(scanId)}.sarif`, content, 'sarif');
  });
  handle(IPC.workbenchBootstrap, () => workbench.bootstrap());
  handle(IPC.sessionEvidence, (id: string) => workbench.bundle(id));
  handle(IPC.workspaceGet, (key: string) => workbench.workspace(key));
  handle(IPC.workspaceSave, (key: string, state: WorkspaceState) => workbench.saveWorkspace(key, state));
  handle(IPC.sessionCreate, async (input: { title: string; scanId: string; findingIds: string[]; folderPath?: string; handoff?: string }) => {
    if (input.folderPath) {
      input.folderPath = await folders.require(input.folderPath);
      const page = await workbench.results(input.scanId);
      const binding = bindings.get(input.folderPath, page.connectionId!);
      if (binding?.projectId !== page.scan?.projectId) throw new Error('Link the folder to the scan project before starting a remediation.');
    }
    return workbench.createSession(input);
  });
  handle(IPC.sessionUpdate, (input: Parameters<WorkbenchService['updateSession']>[0]) => workbench.updateSession(input));
  handle(IPC.sessionDelete, async (id: string) => {
    const session = await workbench.session(id);
    if (session.verificationJobId && jobs.has(session.verificationJobId)) throw new Error('Wait for verification to finish before deleting this session.');
    store.deleteSession(id);
  });
  handle(IPC.sessionVerify, (input: { id: string; scanId: string }) => workbench.verify(input.id, input.scanId));
  const preparingVerification = new Set<string>();
  handle(IPC.sessionRunVerification, async (id: string) => {
    if (preparingVerification.has(id)) throw new Error('This verification scan is already being prepared.');
    preparingVerification.add(id);
    try {
      const session = await workbench.session(id);
      if (session.verificationJobId && jobs.has(session.verificationJobId)) throw new Error('This session already has a running verification scan.');
      if (await workbench.connection() !== session.connectionId) throw new Error('Restore the original connection before verifying this session.');
      const baseline = store.sessionSnapshot(id, 'baseline');
      const provenance = baseline?.provenance;
      if (!provenance || !session.folderPath) throw new Error('This imported scan has no recorded local scan options. Run a scan in Scan, then select it here for verification.');
      const folderPath = await folders.require(session.folderPath);
      const git = await getGitInfo(folderPath);
      const job = await runScan({ folderPath, projectId: session.projectId, projectName: session.projectName, options: { ...provenance.options, branch: git.branch || provenance.options.branch } }, (prepared) => {
        const latest = store.session(id);
        if (!latest) throw new Error('The remediation session was removed before submission.');
        store.saveVerificationJob(prepared, { ...latest, status: 'awaiting_verification', verificationJobId: prepared.id, updatedAt: Date.now() });
      });
      return job;
    } finally { preparingVerification.delete(id); }
  });
  handle(IPC.sessionExport, async (id: string) => {
    const bundle = await workbench.bundle(id);
    return saveEvidence('Export remediation evidence', `marx-${safeFileName(bundle.session.title)}.json`, JSON.stringify(bundle, null, 2), 'json');
  });
  handle(IPC.jobReconcile, async (id: string) => {
    const job = await workbench.requireJob(id);
    if (!job.scanId) throw new Error('No remote scan ID was captured. Check Checkmarx One before starting another scan.');
    if (jobs.has(job.id)) return jobs.get(job.id)!;
    jobs.set(job.id, job);
    void runner.reconcile(job).catch((error) => {
      jobs.delete(job.id);
      job.status = 'Unknown'; job.monitoringStatus = 'stopped'; job.finishedAt = Date.now();
      job.error = error instanceof Error ? error.message : String(error);
      job.progress = { phase: 'failed', detail: job.error };
      persistProgress(job);
      pushEvent({ kind: 'job-updated', job });
    });
    return job;
  });
  handle(IPC.jobLogs, async (id: string) => {
    const connectionId = await workbench.localConnection();
    if (!store.jobs(connectionId).some((job) => job.id === id)) throw new Error('The job is unavailable in this connection.');
    return store.logs(id);
  });
  handle(IPC.snapshotDelete, async (scanId: string) => store.deleteSnapshot(await workbench.localConnection(), scanId));
  handle(IPC.workbenchPrune, (days: number) => {
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('Choose a retention period between 1 and 3,650 days.');
    store.prune(days);
  });

  void workbench.connection().then((connectionId) => {
    for (const job of interrupted.filter((item) => item.connectionId === connectionId).slice(0, 8)) {
      jobs.set(job.id, job);
      void runner.reconcile(job).catch((error) => {
        jobs.delete(job.id);
        job.error = error instanceof Error ? error.message : String(error);
        persistProgress(job);
        pushEvent({ kind: 'job-updated', job });
      });
    }
  }).catch(() => undefined);
}
