// Renderer-side API surface implemented by the preload bridge.
// Kept electron-free so both node and web tsconfigs can consume it.

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
} from './types';

import type { MenuAction } from './ipc';

export interface SourceSnippet {
  path: string;
  startLine: number;
  endLine: number;
  lines: string[];
  totalLines: number;
}

export interface MarxApi {
  platform: string;
  settings: {
    get(): Promise<Settings>;
    save(s: Partial<Settings>): Promise<Settings>;
    setApiKey(key: string): Promise<Settings>;
    testConnection(): Promise<TestConnectionResult>;
  };
  dialog: {
    selectFolder(): Promise<string | null>;
    selectCli(): Promise<string | null>;
  };
  fs: {
    pathForFile(file: File): Promise<string>;
    readSourceFile(folder: string, relPath: string, line?: number): Promise<SourceSnippet>;
  };
  git: {
    info(folder: string): Promise<GitInfo>;
    listSubProjects(parent: string): Promise<string[]>;
  };
  projects: {
    list(): Promise<ProjectInfo[]>;
  };
  scan: {
    run(input: {
      folderPath: string;
      projectName: string;
      projectId?: string;
      options: ScanOptions;
    }): Promise<ScanJobState>;
    runBatch(input: {
      items: { folderPath: string; projectName: string; projectId?: string }[];
      options: ScanOptions;
      concurrency: number;
    }): Promise<ScanJobState[]>;
    cancelJob(job: ScanJobState): Promise<void>;
    jobs(): Promise<ScanJobState[]>;
    history(): Promise<ScanHistoryItem[]>;
    summary(scanId: string): Promise<unknown>;
  };
  results: {
    get(scanId: string): Promise<ResultsPage>;
    triage(req: TriageRequest): Promise<boolean>;
    /** Write findings to ~/Downloads and reveal in Finder; returns the file path */
    export(format: 'csv' | 'json', label: string, findings: Finding[]): Promise<string>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  onScanEvent(listener: (event: ScanEvent) => void): () => void;
  onMenuAction(listener: (action: MenuAction) => void): () => void;
}
