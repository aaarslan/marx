import type { Finding, ResultsPage, ScanHistoryItem, ScanJobState, ScanOptions, Severity } from './types';

export interface SourceProvenance {
  folderPath: string;
  repositoryRoot?: string;
  branch: string;
  commit?: string;
  dirty: boolean;
  fingerprint?: string;
  capturedAt: number;
  snapshot: boolean;
  fingerprintScope?: 'git-visible-files' | 'folder-files';
  capturedFiles?: number;
  captureWarning?: string;
}

export interface ScanProvenance {
  version: 1;
  connectionId: string;
  capturedAt: number;
  cliVersion?: string;
  source: SourceProvenance;
  options: ScanOptions;
  optionsFingerprint: string;
  requestedScanners: string[];
  completedScanners?: string[];
  effectiveConfigFingerprint?: string;
  sourceChanged?: boolean;
}

export type FindingChange = 'NEW' | 'PERSISTENT' | 'ESCALATED' | 'REDUCED' | 'UNCERTAIN';

export interface ScanComparison {
  compatibility: 'comparable' | 'inconclusive' | 'incompatible';
  reasons: string[];
  changes: Record<string, FindingChange>;
  newBySeverity: Partial<Record<Severity, number>>;
  newCount: number;
  persistentCount: number;
  escalatedCount: number;
  reducedCount: number;
  absent: Finding[];
  verdict: 'pass' | 'attention' | 'inconclusive';
  headline: string;
}

export interface RemediationGroup {
  id: string;
  title: string;
  rationale: string;
  findingIds: string[];
  severity: Severity;
  type: string;
}

export interface VerificationRecord {
  scanId: string;
  checkedAt: number;
  comparison: ScanComparison;
  remainingIds: string[];
  absentIds: string[];
  newIds: string[];
}

export interface RemediationSession {
  id: string;
  connectionId: string;
  title: string;
  baselineScanId: string;
  projectId: string;
  projectName: string;
  folderPath?: string;
  findingIds: string[];
  status: 'open' | 'in_progress' | 'awaiting_verification' | 'verified' | 'unresolved';
  createdAt: number;
  updatedAt: number;
  notes: string;
  changeRef: string;
  checks: string;
  handoff?: string;
  verificationJobId?: string;
  verification?: VerificationRecord;
}

export interface WorkspaceState {
  connectionId?: string;
  view?: string;
  selectedSessionId?: string;
  workbenchTab?: 'sessions' | 'activity' | 'decisions';
  selectedScanId?: string | null;
  linkedFolder?: string | null;
  selectedFindingId?: string | null;
  baselineId?: string | null;
  intelligenceFilter?: string;
  search?: string;
  severities?: Severity[];
  scanner?: string;
  state?: string;
  change?: string;
  includeOtherBranches?: boolean;
  groupByFix?: boolean;
  pageIndex?: number;
  scrollTop?: number;
  detailWidth?: number;
}

export interface WorkbenchBootstrap {
  connectionId: string | null;
  jobs: ScanJobState[];
  sessions: RemediationSession[];
  scans: ScanHistoryItem[];
  logs: Record<string, string[]>;
}

export interface FindingQuery {
  search?: string;
  severities?: Severity[];
  scanner?: string;
  state?: string;
  offset?: number;
  limit?: number;
}

export interface FindingQueryPage {
  findings: Finding[];
  filteredCount: number;
  totalCount: number;
}

export interface EvidenceBundle {
  format: 'marx-remediation';
  version: 1;
  exportedAt: string;
  session: RemediationSession;
  baseline: ResultsPage;
  intelligence?: Record<string, import('./intelligence').IntelligenceSnapshot>;
  currentIntelligence?: Record<string, import('./intelligence').IntelligenceSnapshot>;
  verification?: ResultsPage;
}
