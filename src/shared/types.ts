// Shared domain types used by main process, preload bridge, and renderer.

export type ScannerType = 'sast' | 'sca';

export const SCAN_STATUSES = [
  'Queued',
  'Running',
  'Completed',
  'Failed',
  'Canceled',
  'Partial'
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number] | 'Unknown';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type ResultState =
  | 'TO_VERIFY'
  | 'NOT_EXPLOITABLE'
  | 'PROPOSED_NOT_EXPLOITABLE'
  | 'CONFIRMED'
  | 'URGENT';

export type ResultStatus = 'NEW' | 'RECURRENT' | 'FIXED' | 'UNCHANGED';

export interface Settings {
  cliPath: string;
  cliConfigPath: string;
  cliAuthMode: 'cli' | 'marx';
  /** Optional explicit AST base URL, e.g. https://<tenant>.ast.checkmarx.net.
   *  When empty, derived from the access token's ast-base-url claim. */
  baseUrl: string;
  /** Optional tenant name; only needed when the API key doesn't self-describe. */
  tenant: string;
  /** Whether an API key is stored (the key itself lives in the OS keychain). */
  hasApiKey: boolean;
  /** recently scanned folders, most recent first (max 8) */
  recentFolders: string[];
  defaults: ScanDefaults;
}

export interface ScanDefaults {
  scanners: ScannerType[];
  sastPreset: string;
  sastIncremental: boolean;
  scaExploitablePath: boolean;
  excludeNodeModules: boolean;
  /** Extra exclude patterns beyond the always-on list. */
  extraExcludes: string[];
  batchConcurrency: number;
}

export interface ScanOptions {
  scanners: ScannerType[];
  branch: string;
  /** SAST */
  sastPreset: string;
  sastIncremental: boolean;
  sastBaseBranch?: string;
  /** SCA */
  scaExploitablePath: boolean;
  /** comma/newline-separated glob-ish names, matched against top-level segments */
  excludes: string[];
  tags: Record<string, string>;
}

export type ScanPhase =
  | 'idle'
  | 'submitting'
  | 'resolving-project'
  | 'zipping'
  | 'uploading'
  | 'queued'
  | 'running'
  | 'fetching-results'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface ScanProgress {
  phase: ScanPhase;
  /** human readable detail, e.g. engine status or bytes uploaded */
  detail?: string;
  /** 0..100 when the phase has measurable progress */
  percent?: number;
  /** queue position when phase === 'queued' */
  queuePosition?: number;
}

export interface SeverityCounts {
  CRITICAL: number;
  HIGH: number;
  MEDIUM: number;
  LOW: number;
  INFO: number;
}

export const emptySeverityCounts = (): SeverityCounts => ({
  CRITICAL: 0,
  HIGH: 0,
  MEDIUM: 0,
  LOW: 0,
  INFO: 0
});

export interface ScanJobState {
  batchId?: string;
  /** local job id */
  id: string;
  folderPath: string;
  /** display name = project name on the platform */
  projectName: string;
  /** resolved platform project id once known */
  projectId?: string;
  scanId?: string;
  branch: string;
  options: ScanOptions;
  progress: ScanProgress;
  status: ScanStatus;
  error?: string;
  summary?: SeverityCounts;
  startedAt: number;
  finishedAt?: number;
}

export interface ProjectInfo {
  id: string;
  name: string;
  mainBranch: string;
  tags: Record<string, string>;
  lastScanDate?: string;
}

export interface ScanHistoryItem {
  id: string;
  projectId: string;
  projectName: string;
  branch: string;
  status: ScanStatus;
  createdAt: string;
  updatedAt: string;
  sourceOrigin?: string;
  tags?: Record<string, string>;
}

/** One step in a SAST source→sink flow. */
export interface FlowNode {
  fileName: string;
  line: number;
  column?: number;
  name?: string;
  fullName?: string;
  method?: string;
  typeName?: string;
}

/** Normalized finding shown in the results table. */
export interface Finding {
  id: string;
  scanId: string;
  projectId: string;
  type: ScannerType | 'kics' | 'secrets' | string;
  label: string;
  similarityId: string;
  severity: Severity;
  state: ResultState;
  status: ResultStatus;
  created?: string;
  title: string;
  /** short location string, e.g. "src/app.js:42" */
  where: string;
  /** language for SAST findings */
  language?: string;
  /** query group (SAST) or package (SCA) */
  group?: string;
  cwe?: string;
  cve?: string;
  cvssScore?: number;
  description: string;
  compliances?: string[];
  flow: FlowNode[];
  /** SCA extras */
  packageName?: string;
  packageVersion?: string;
  packageManager?: string;
  recommendedVersion?: string;
  isDirectDependency?: boolean;
  fixLink?: string;
  /** severity count bucket derived values */
  comments?: unknown;
}

export interface ResultsPage {
  truncated?: boolean;
  findings: Finding[];
  totalCount: number;
}

export interface TriageRequest {
  finding: Finding;
  state: ResultState;
  severity?: Severity;
  comment: string;
}

export interface TestConnectionResult {
  cliPath?: string;
  cliVersion?: string;
  ok: boolean;
  message: string;
  apiBase?: string;
  authEndpoint?: string;
  tenant?: string;
}

/** Events pushed from main → renderer over the 'scan:event' channel. */
export type ScanEvent =
  | { kind: 'job-updated'; job: ScanJobState }
  | { kind: 'job-list'; jobs: ScanJobState[] }
  | { kind: 'log'; jobId: string; line: string }
  | { kind: 'open-results'; scanId: string; folderPath?: string };

export interface GitInfo {
  branch: string;
  repoName: string;
  hasGit: boolean;
}

export const RESULT_STATES: { value: ResultState; label: string }[] = [
  { value: 'TO_VERIFY', label: 'To Verify' },
  { value: 'NOT_EXPLOITABLE', label: 'Not Exploitable' },
  { value: 'PROPOSED_NOT_EXPLOITABLE', label: 'Proposed Not Exploitable' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'URGENT', label: 'Urgent' }
];

export const DEFAULT_EXCLUDES = [
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.DS_Store',
  'dist',
  'build',
  'target',
  '.next',
  'out',
  'coverage',
  '.turbo',
  '.gradle'
];

export const DEFAULT_SETTINGS: Settings = {
  cliPath: '',
  cliConfigPath: '',
  cliAuthMode: 'cli',
  baseUrl: '',
  tenant: '',
  hasApiKey: false,
  recentFolders: [],
  defaults: {
    scanners: ['sast', 'sca'],
    sastPreset: 'Checkmarx Default',
    sastIncremental: true,
    scaExploitablePath: false,
    excludeNodeModules: true,
    extraExcludes: [],
    batchConcurrency: 2
  }
};

export function hasScanCredentials(settings: Settings | null | undefined): settings is Settings {
  return Boolean(settings && (settings.cliAuthMode === 'cli' || settings.hasApiKey));
}
