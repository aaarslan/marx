import type { ScanHistoryItem } from './types';

export function baselineCandidates(current: ScanHistoryItem | undefined, history: ScanHistoryItem[], includeOtherBranches = false): ScanHistoryItem[] {
  if (current?.status !== 'Completed' || !current.projectId || !current.branch || !Number.isFinite(Date.parse(current.createdAt))) return [];
  return history.filter((scan) => scan.id !== current.id && scan.projectId === current.projectId &&
    scan.status === 'Completed' && Boolean(scan.branch) && (includeOtherBranches || scan.branch === current.branch) &&
    Date.parse(scan.createdAt) < Date.parse(current.createdAt))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
