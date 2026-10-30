import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type MenuAction } from '@shared/ipc';
import type { MarxApi, SourceSnippet } from '@shared/api-contract';
import type {
  Finding,
  GitInfo,
  ProjectInfo,
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

const api = {
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
    readSourceFile: (folder: string, relPath: string, line?: number) =>
      call<SourceSnippet>(IPC.readSourceFile, folder, relPath, line)
  },
  git: {
    info: (folder: string) => call<GitInfo>(IPC.gitInfo, folder),
    listSubProjects: (parent: string) => call<string[]>(IPC.listSubfolders, parent)
  },
  projects: {
    list: () => call<ProjectInfo[]>(IPC.projectsList)
  },
  scan: {
    run: (input: { folderPath: string; projectName: string; projectId?: string; options: ScanOptions }) =>
      call<ScanJobState>(IPC.scanRun, input),
    runBatch: (input: {
      items: { folderPath: string; projectName: string; projectId?: string }[];
      options: ScanOptions;
      concurrency: number;
    }) => call<ScanJobState[]>(IPC.scanRunBatch, input),
    cancelJob: (job: ScanJobState) => call<void>(IPC.scanCancelJob, job),
    jobs: () => call<ScanJobState[]>(IPC.scanJobs),
    history: () => call<ScanHistoryItem[]>(IPC.scanHistory),
    summary: (scanId: string) => call<unknown>(IPC.scanSummary, scanId)
  },
  results: {
    get: (scanId: string) => call<ResultsPage>(IPC.resultsGet, scanId),
    triage: (req: TriageRequest) => call<boolean>(IPC.resultsTriage, req),
    export: (format: 'csv' | 'json', label: string, findings: Finding[]) =>
      call<string>(IPC.resultsExport, { format, label, findings })
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
