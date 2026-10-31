import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type MenuAction } from '@shared/ipc';
import type { MarxApi, SourceSnippet } from '@shared/api-contract';
import type { FindingQuery, FindingQueryPage, RemediationSession, ScanComparison, WorkbenchBootstrap, WorkspaceState } from '@shared/workbench';
import type {
  Finding,
  GitInfo,
  ProjectInfo,
  RepositoryBinding,
  ResultsPage,
  ScanEvent,
  ScanHistoryItem,
  ScanJobState,
  ScanOptions,
  Settings,
  TestConnectionResult,
  TriageRequest
} from '@shared/types';

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

const api: MarxApi = {
  platform: process.platform,
  settings: {
    get: () => call<Settings>(IPC.settingsGet),
    save: (s: Partial<Settings>) => call<Settings>(IPC.settingsSave, s),
    setApiKey: (key: string) => call<Settings>(IPC.settingsSetApiKey, key),
    testConnection: () => call<TestConnectionResult>(IPC.testConnection)
  },
  dialog: {
    selectFolder: () => call<string | null>(IPC.selectFolder),
    selectCli: () => call<string | null>(IPC.selectCli)
  },
  fs: {
    pathForFile: (file: File) => {
      const path = webUtils.getPathForFile(file);
      return path ? call<string>(IPC.authorizeFolder, path) : Promise.resolve('');
    },
    readSourceFile: (folder: string, relPath: string, line?: number, projectId?: string) =>
      call<SourceSnippet>(IPC.readSourceFile, folder, relPath, line, projectId),
    openInEditor: (folder, relPath, line, projectId, editor) => call<void>(IPC.openInEditor, folder, relPath, line, projectId, editor),
    sourceStatus: (folder, scanId) => call<{ matches: boolean | null; message: string }>(IPC.sourceStatus, folder, scanId)
  },
  git: {
    info: (folder: string) => call<GitInfo>(IPC.gitInfo, folder),
    listSubProjects: (parent: string) => call<string[]>(IPC.listSubfolders, parent),
    plan: (parent: string) => call<import('@shared/workspace').WorkspacePlan>(IPC.workspacePlan, parent)
  },
  bindings: {
    get: (folder: string) => call<RepositoryBinding | null>(IPC.bindingGet, folder),
    save: (folder: string, projectId: string) => call<RepositoryBinding>(IPC.bindingSave, folder, projectId)
  },
  projects: {
    list: () => call<ProjectInfo[]>(IPC.projectsList)
  },
  scan: {
    run: (input: { folderPath: string; projectName: string; projectId?: string; options: ScanOptions }) =>
      call<ScanJobState>(IPC.scanRun, input),
    runBatch: (input: {
      items: { folderPath: string; projectName: string; projectId?: string; options?: ScanOptions }[];
      options: ScanOptions;
      concurrency: number;
    }) => call<ScanJobState[]>(IPC.scanRunBatch, input),
    cancelJob: (job: ScanJobState) => call<void>(IPC.scanCancelJob, job),
    jobs: () => call<ScanJobState[]>(IPC.scanJobs),
    history: (options) => call<ScanHistoryItem[]>(IPC.scanHistory, options),
    summary: (scanId: string) => call<unknown>(IPC.scanSummary, scanId)
  },
  results: {
    get: (scanId: string, options) => call<ResultsPage>(IPC.resultsGet, scanId, options),
    cancel: (requestId) => call<void>(IPC.resultsCancel, requestId),
    compare: (baselineId, currentId) => call<ScanComparison>(IPC.resultsCompare, baselineId, currentId),
    query: (scanId: string, query: FindingQuery) => call<FindingQueryPage>(IPC.resultsQuery, scanId, query),
    sarif: (scanId) => call<string | null>(IPC.resultsSarif, scanId),
    triage: (req: TriageRequest) => call<boolean>(IPC.resultsTriage, req),
    export: (format: 'csv' | 'json', label: string, findings: Finding[]) =>
      call<string>(IPC.resultsExport, { format, label, findings })
  },
  remediation: {
    copy: (text: string) => call<void>(IPC.remediationCopy, text),
    save: (input: { text: string; suggestedName: string }) => call<string | null>(IPC.remediationSave, input)
  },
  workbench: {
    bootstrap: () => call<WorkbenchBootstrap>(IPC.workbenchBootstrap),
    evidence: (id: string) => call<import('@shared/workbench').EvidenceBundle>(IPC.sessionEvidence, id),
    workspace: (key) => call<WorkspaceState | null>(IPC.workspaceGet, key),
    saveWorkspace: (key, state) => call<void>(IPC.workspaceSave, key, state),
    createSession: (input) => call<RemediationSession>(IPC.sessionCreate, input),
    updateSession: (input) => call<RemediationSession>(IPC.sessionUpdate, input),
    deleteSession: (id) => call<void>(IPC.sessionDelete, id),
    verifySession: (input) => call<RemediationSession>(IPC.sessionVerify, input),
    runVerification: (id) => call<ScanJobState>(IPC.sessionRunVerification, id),
    exportSession: (id) => call<string | null>(IPC.sessionExport, id),
    reconcileJob: (id) => call<ScanJobState>(IPC.jobReconcile, id),
    logs: (id) => call<string[]>(IPC.jobLogs, id),
    deleteSnapshot: (id) => call<void>(IPC.snapshotDelete, id),
    prune: (days) => call<void>(IPC.workbenchPrune, days)
  },
  shell: {
    openExternal: (url: string) => call<void>(IPC.openExternal, url)
  },
  onScanEvent: (listener: (event: ScanEvent) => void) => {
    const wrapped = (_e: unknown, payload: ScanEvent) => listener(payload);
    ipcRenderer.on(IPC.scanEvent, wrapped as never);
    return () => ipcRenderer.removeListener(IPC.scanEvent, wrapped as never);
  },
  onMenuAction: (listener: (action: MenuAction) => void) => {
    const wrapped = (_e: unknown, action: MenuAction) => listener(action);
    ipcRenderer.on(IPC.menuAction, wrapped as never);
    return () => ipcRenderer.removeListener(IPC.menuAction, wrapped as never);
  }
};

export type { MarxApi };

contextBridge.exposeInMainWorld('marx', api);
