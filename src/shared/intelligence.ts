export type IntelligenceSource = "kev" | "epss" | "cve";
export type IntelligenceState =
  | "fresh"
  | "stale"
  | "unavailable"
  | "disabled"
  | "not_checked";
export interface IntelligenceValue {
  listed?: boolean;
  vendor?: string;
  product?: string;
  dateAdded?: string;
  dueDate?: string;
  action?: string;
  ransomware?: string;
  catalogVersion?: string;
  probability?: number;
  percentile?: number;
  date?: string;
  recordState?: string;
  title?: string;
  updated?: string;
  scores?: {
    provider: string;
    version: string;
    score: number;
    vector: string;
  }[];
  references?: { url: string; title: string; kind: string; provider: string }[];
  ssvc?: {
    provider: string;
    role: string;
    timestamp: string;
    options: { name: string; value: string }[];
  }[];
}
export interface IntelligenceObservation {
  source: IntelligenceSource;
  state: IntelligenceState;
  value: IntelligenceValue | null;
  fetchedAt?: number;
  checkedAt?: number;
  expiresAt?: number;
  error?: string;
}
export interface IntelligenceSnapshot {
  cve: string;
  checkedAt?: number;
  synthetic?: boolean;
  sources: IntelligenceObservation[];
}
export interface IntelligenceSettings {
  enabledSources: IntelligenceSource[];
  providers: {
    id: IntelligenceSource;
    name: string;
    host: string;
    description: string;
  }[];
}
export interface IntelligenceWatchlist {
  items: { cve: string; createdAt: number }[];
  snapshots: Record<string, IntelligenceSnapshot>;
  events: {
    id: string;
    cve: string;
    at: number;
    changes: string[];
    before: IntelligenceSnapshot;
    after: IntelligenceSnapshot;
  }[];
}
export type DecisionVerdict =
  | "patch_now"
  | "defer"
  | "accept"
  | "not_affected"
  | "mitigated";
export interface DecisionInput {
  connectionId: string;
  scanId: string;
  findingId: string;
  expectedRevision: number;
  verdict: DecisionVerdict;
  note: string;
  reviewAt: string;
  assumptions: { notInKev?: boolean; epssBelow?: number; manual: string };
}
export interface IntelligenceDecision
  extends Omit<DecisionInput, "expectedRevision"> {
  id: string;
  revision: number;
  connectionId: string;
  projectId: string;
  cve: string;
  packageName: string;
  packageVersion: string;
  packageManager: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  evidence: IntelligenceSnapshot;
  currentEvidence?: IntelligenceSnapshot;
  closed: boolean;
  closeReason?: string;
  reviewState:
    | "active"
    | "needs_review"
    | "review_due"
    | "unavailable"
    | "closed";
  reviewReasons: string[];
  reviewAlert?: {
    at: number;
    reasons: string[];
    evidence: IntelligenceSnapshot;
  };
}
export const DECISION_LABELS: Record<DecisionVerdict, string> = {
  patch_now: "Patch now",
  defer: "Defer",
  accept: "Accept risk",
  not_affected: "Not affected",
  mitigated: "Mitigated",
};
export function findingCVE(value?: string): string | null {
  const cve = value?.trim().toUpperCase();
  return cve && /^CVE-(1999|20\d{2})-\d{4,19}$/.test(cve) ? cve : null;
}
export function intelSource(
  snapshot: IntelligenceSnapshot | undefined,
  source: IntelligenceSource,
): IntelligenceObservation | undefined {
  return snapshot?.sources.find((item) => item.source === source);
}
export function intelligenceLabel(snapshot?: IntelligenceSnapshot): string {
  const kev = intelSource(snapshot, "kev");
  if (kev?.value?.listed)
    return kev.state === "fresh" ? "Known exploited" : "KEV evidence · cached";
  const epss = intelSource(snapshot, "epss");
  if (epss?.state === "fresh" && epss.value?.probability != null)
    return `EPSS ${(epss.value.probability * 100).toFixed(2)}%`;
  return "Intelligence not current";
}
export function matchesIntelligence(
  snapshot: IntelligenceSnapshot | undefined,
  filter: string,
): boolean {
  if (filter === "kev")
    return intelSource(snapshot, "kev")?.value?.listed === true;
  if (filter === "epss") {
    const source = intelSource(snapshot, "epss");
    return (
      source?.state === "fresh" && (source.value?.probability ?? -1) >= 0.1
    );
  }
  if (filter === "unknown")
    return (
      !snapshot || !snapshot.sources.some((source) => source.state === "fresh")
    );
  return true;
}
