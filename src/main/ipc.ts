import { BrowserWindow, Notification, app, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IPC } from '@shared/ipc';
import type {
  GitInfo,
  ProjectInfo,
  ResultsPage,
  ScanHistoryItem,
  ScanJobState,
  ScanOptions,
  Settings,
  TriageRequest,
  TestConnectionResult
} from '@shared/types';
import { CxOneApiError, CxOneClient } from './cxone/client';
import { normalizeFinding } from './cxone/normalize';
import { getApiKey, loadSettings, saveSettings, setApiKey as persistApiKey } from './settings';
import { getGitInfo, listSubProjects } from './gitInfo';
import { ScanRunner } from './scanRunner';
import { BatchRunner } from './batchRunner';
import { SourceFolders } from './sourceFolders';
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

export function getClient(): CxOneClient {
  const settings = loadSettings();
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new CxOneApiError(
      'No API key configured. Add your Checkmarx One API key in Settings first.',
      401,
      'settings'
    );
  }
  return new CxOneClient({ apiKey, baseUrl: settings.baseUrl, tenant: settings.tenant });
}

export function registerIpcHandlers(ctx: IpcContext): void {
  const pushEvent = (payload: unknown) => {
    ctx.getWindow()?.webContents.send(IPC.scanEvent, payload);
  };

  const folders = new SourceFolders(loadSettings().recentFolders);
  const jobPhase = new Map<string, string>();

  const jobs = new Map<string, ScanJobState>();
  let cachedClient: CxOneClient | null = null;
  const client = () => cachedClient ??= getClient();

  const runner = new ScanRunner(client, {
    onJobUpdated: (job) => {
      if (job.finishedAt) jobs.delete(job.id);
      else if (!jobs.has(job.id)) jobs.set(job.id, job);
      // macOS notification when a scan settles (completed / failed / canceled)
      const prev = jobPhase.get(job.id);
      const phase = job.progress.phase;
      if (job.finishedAt) jobPhase.delete(job.id);
      else jobPhase.set(job.id, phase);
      const settled = phase === 'completed' || phase === 'failed' || phase === 'canceled';
      if (settled && prev !== undefined && prev !== phase) {
        if (phase === 'completed') {
          notify(ctx, 'Scan completed', `${job.projectName} (${job.branch}) finished successfully.`,
            job.scanId ? { scanId: job.scanId, folderPath: job.folderPath } : undefined);
        } else if (phase === 'failed') {
          notify(ctx, 'Scan failed', `${job.projectName}: ${job.error ?? 'unknown error'}`);
        } else {
          notify(ctx, 'Scan canceled', `${job.projectName} was canceled.`);
        }
      }
      pushEvent({ kind: 'job-updated', job });
    },
    onLog: (jobId, line) => pushEvent({ kind: 'log', jobId, line })
  });

  let preparingBatch = false;
  const ensureBatchRunner = () => {
    if (!batchRunner) {
      batchRunner = new BatchRunner(runner, (batchJobs) => {
        for (const job of batchJobs) {
          if (job.finishedAt) jobs.delete(job.id);
          else if (!jobs.has(job.id)) jobs.set(job.id, job);
        }
        pushEvent({ kind: 'job-list', jobs: batchJobs });
      });
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
    return saveSettings({ baseUrl: settings.baseUrl ?? loadSettings().baseUrl, tenant: settings.tenant ?? loadSettings().tenant, defaults: settings.defaults ?? loadSettings().defaults });
  });
  handle(IPC.settingsSetApiKey, (key: string) => {
    persistApiKey(key);
    cachedClient = null;
    return loadSettings();
  });
  handle(IPC.testConnection, async (): Promise<TestConnectionResult> => {
    const apiClient = client();
    const { apiBase, authEndpoint } = await apiClient.testConnection();
    // a cheap authorized call proves the whole chain
    await apiClient.listProjects(1);
    return { ok: true, message: 'Connected', apiBase, authEndpoint };
  });

  // ---- dialogs / fs --------------------------------------------------------
  handle(IPC.selectFolder, async (): Promise<string | null> => {
    const win = ctx.getWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : await folders.grant(result.filePaths[0]);
  });

  handle(IPC.authorizeFolder, (folder: string) => folders.grant(folder));

  handle(IPC.readSourceFile, async (folder: string, relativePath: string, line?: number) => {
    return readSourceSnippet(await folders.require(folder), relativePath, line);
  });

  handle(IPC.gitInfo, async (folder: string): Promise<GitInfo> => getGitInfo(await folders.require(folder)));
  handle(IPC.listSubfolders, async (parent: string): Promise<string[]> => {
    const children = listSubProjects(await folders.require(parent));
    return Promise.all(children.map((folder) => folders.grant(folder)));
  });

  handle(IPC.openExternal, (url: string) => {
    if (/^https:\/\//.test(url)) {
      void shell.openExternal(url);
    }
  });

  // ---- projects ------------------------------------------------------------
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
  handle(IPC.scanRun, async (input: { folderPath: string; projectName: string; projectId?: string; options: ScanOptions }) => {
    input.folderPath = await folders.require(input.folderPath);
    recordRecentFolder(input.folderPath);
    const job = runner.newJob(input);
    jobs.set(job.id, job);
    void runner.run(job); // progress flows via events; don't block the round-trip
    return job;
  });

  handle(IPC.scanRunBatch, async (input: {
    items: { folderPath: string; projectName: string; projectId?: string }[];
    options: ScanOptions;
    concurrency: number;
  }) => {
    const b = ensureBatchRunner();
    // each subproject may be on its own branch — detect per folder
    if (preparingBatch || b.isRunning()) throw new Error('A batch is already running.');
    preparingBatch = true;
    try {
      const inputs = [];
      for (const i of input.items) {
        const folderPath = await folders.require(i.folderPath);
        const git = await getGitInfo(folderPath);
        inputs.push({ ...i, folderPath, options: { ...input.options, branch: git.branch || input.options.branch } });
      }
      void b.runAll(inputs, input.concurrency);
      return b.getJobs();
    } finally { preparingBatch = false; }
  });

  handle(IPC.scanCancelJob, async (job: ScanJobState) => {
    const current = jobs.get(job.id);
    if (current) await runner.cancelJob(current);
  });

  handle(IPC.scanJobs, () => batchRunner?.getJobs() ?? []);

  handle(IPC.scanHistory, async (): Promise<ScanHistoryItem[]> => {
    const { scans } = await client().listScans({ limit: 50 });
    return scans.map((s) => ({
      id: s.id,
      projectId: s.projectId ?? '',
      projectName: s.projectName ?? '',
      branch: s.branch ?? '',
      status: (s.status as ScanHistoryItem['status']) ?? 'Unknown',
      createdAt: s.createdAt ?? '',
      updatedAt: s.updatedAt ?? '',
      sourceOrigin: s.sourceOrigin,
      tags: s.tags
    }));
  });

  handle(IPC.scanSummary, async (scanId: string) => client().getScanSummary(scanId));

  // ---- results -------------------------------------------------------------
  handle(IPC.resultsGet, async (scanId: string): Promise<ResultsPage> => {
    const apiClient = client();
    // need projectId for triage — read from scan
    const scan = await apiClient.getScan(scanId);
    const raw = await apiClient.getAllResults(scanId);
    const findings = raw.results.map((r) => normalizeFinding(r, scanId, scan.projectId ?? ''));
    findings.sort((a, b) => {
      const order = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 } as const;
      return order[b.severity] - order[a.severity];
    });
    return { findings, totalCount: raw.totalCount, truncated: raw.truncated };
  });

  handle(IPC.resultsTriage, async (req: TriageRequest) => {
    const { finding, state, severity, comment } = req;
    if (!comment.trim()) {
      throw new Error('A comment is required when changing a result state.');
    }
    const apiClient = client();
    if (finding.type === 'sca') {
      if (!finding.packageName) throw new Error('SCA finding has no package name — cannot triage.');
      await apiClient.triageSca({
        packageName: finding.packageName,
        packageVersion: finding.packageVersion ?? '',
        vulnerabilityId: finding.cve ?? finding.id,
        projectIds: [finding.projectId],
        actions: [{ ActionType: 'ChangeState', Value: state, Comment: comment }]
      });
      } else {
        // sast / kics / other scanners use similarity-id predicates
        await apiClient.triageSast({
          similarityId: finding.similarityId,
          projectId: finding.projectId,
          state,
          severity: severity ?? finding.severity,
          comment
        });
      }
      return true;
  });

  // ---- export ---------------------------------------------------------------
  handle(IPC.resultsExport, async (payload: ExportPayload): Promise<string> => {
    const stamp = new Date().toISOString().replace(/[:.T]/g, '-');
    const name = `marx-${safeFileName(payload.label)}-${stamp}.${payload.format}`;
    const target = path.join(app.getPath('downloads'), name);
    const content =
      payload.format === 'csv'
        ? buildCsv(payload.findings)
        : buildJson(payload.findings);
    fs.writeFileSync(target, content, { encoding: 'utf-8', flag: 'wx' });
    shell.showItemInFolder(target);
    return target;
  });
}
