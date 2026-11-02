import type { IntelligenceSettings, IntelligenceSnapshot, IntelligenceWatchlist, IntelligenceDecision, DecisionInput } from './intelligence';
// Renderer-side API surface implemented by the Wails desktop bridge.

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
} from './types';

import type { MenuAction } from './ipc';
import type { EvidenceBundle, FindingQuery, FindingQueryPage, RemediationSession, ScanComparison, WorkbenchBootstrap, WorkspaceState } from './workbench';

export interface SourceSnippet {
  path: string;
  startLine: number;
  endLine: number;
  lines: string[];
  totalLines: number;
}

export interface MarxApi {
  platform: string;
  intelligence: {
    settings(): Promise<IntelligenceSettings>;
    clearCache(): Promise<void>;
    configure(enabledSources: IntelligenceSettings['enabledSources']): Promise<IntelligenceSettings>;
    get(cves: string[]): Promise<Record<string, IntelligenceSnapshot>>;
    refresh(input: {cves: string[]; requestId: string; force?: boolean; reuseCatalog?: boolean}): Promise<Record<string, IntelligenceSnapshot>>;
    cancel(requestId: string): Promise<void>;
    watch(cve: string): Promise<unknown>;
    unwatch(cve: string): Promise<unknown>;
    watchlist(): Promise<IntelligenceWatchlist>;
    decisions(): Promise<IntelligenceDecision[]>;
    decide(input: DecisionInput): Promise<IntelligenceDecision>;
    closeDecision(input: {id: string; expectedRevision: number; reason: string}): Promise<IntelligenceDecision>;
    history(id: string): Promise<IntelligenceDecision[]>;
    exportDecisions(): Promise<string | null>;
  };
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
    readSourceFile(folder: string, relPath: string, line?: number, projectId?: string): Promise<SourceSnippet>;
    openInEditor(folder: string, relPath: string, line: number, projectId: string, editor: 'code' | 'cursor'): Promise<void>;
    sourceStatus(folder: string, scanId: string): Promise<{ matches: boolean | null; message: string }>;
  };
  git: {
    info(folder: string): Promise<GitInfo>;
    listSubProjects(parent: string): Promise<string[]>;
    plan(parent: string): Promise<import('./workspace').WorkspacePlan>;
  };
  bindings: {
    get(folder: string): Promise<RepositoryBinding | null>;
    save(folder: string, projectId: string): Promise<RepositoryBinding>;
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
      items: { folderPath: string; projectName: string; projectId?: string; options?: ScanOptions }[];
      options: ScanOptions;
      concurrency: number;
    }): Promise<ScanJobState[]>;
    cancelJob(job: ScanJobState): Promise<void>;
    jobs(): Promise<ScanJobState[]>;
    history(options?: { projectId?: string; offset?: number; limit?: number }): Promise<ScanHistoryItem[]>;
    summary(scanId: string): Promise<unknown>;
  };
  results: {
    get(scanId: string, options?: { refresh?: boolean; requestId?: string }): Promise<ResultsPage>;
    cancel(requestId: string): Promise<void>;
    compare(baselineId: string, currentId: string): Promise<ScanComparison>;
    query(scanId: string, query: FindingQuery): Promise<FindingQueryPage>;
    sarif(scanId: string): Promise<string | null>;
    triage(req: TriageRequest): Promise<boolean>;
    /** Write findings to Downloads and reveal in the system file manager; returns the file path */
    export(format: 'csv' | 'json', label: string, findings: Finding[]): Promise<string>;
  };
  remediation: {
    copy(text: string): Promise<void>;
    save(input: { text: string; suggestedName: string }): Promise<string | null>;
  };
  workbench: {
    bootstrap(): Promise<WorkbenchBootstrap>;
    evidence(id: string): Promise<EvidenceBundle>;
    workspace(key: string): Promise<WorkspaceState | null>;
    saveWorkspace(key: string, state: WorkspaceState): Promise<void>;
    createSession(input: { title: string; scanId: string; findingIds: string[]; folderPath?: string; handoff?: string }): Promise<RemediationSession>;
    updateSession(input: { id: string; title?: string; notes?: string; changeRef?: string; checks?: string; status?: 'open' | 'in_progress' | 'awaiting_verification'; handoff?: string }): Promise<RemediationSession>;
    deleteSession(id: string): Promise<void>;
    verifySession(input: { id: string; scanId: string }): Promise<RemediationSession>;
    runVerification(id: string): Promise<ScanJobState>;
    exportSession(id: string): Promise<string | null>;
    reconcileJob(id: string): Promise<ScanJobState>;
    logs(jobId: string): Promise<string[]>;
    deleteSnapshot(scanId: string): Promise<void>;
    prune(days: number): Promise<void>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  onFolderDrop(listener: (folder: string) => void): () => void;
  onScanEvent(listener: (event: ScanEvent) => void): () => void;
  onMenuAction(listener: (action: MenuAction) => void): () => void;
}
