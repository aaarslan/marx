import type { CxResult } from './types';
import { createHash } from 'node:crypto';
import type { Finding, Severity } from '@shared/types';
import { normalizeSeverity } from '@shared/severity';

/**
 * Map a raw /api/results item to the UI Finding model.
 * Defensive by design: the payload shape varies per scanner (sast/sca/kics).
 */
export function normalizeFinding(raw: CxResult, scanId: string, projectId: string): Finding {
  const type = String(raw.type ?? 'unknown').toLowerCase();
  const data = raw.data ?? {};
  const vd = raw.vulnerabilityDetails ?? {};

  let title = 'Finding';
  let where = '';
  let flow: Finding['flow'] = [];

  if (type === 'sast') {
    title = data.queryName ?? 'SAST finding';
    const nodes = data.nodes ?? [];
    flow = nodes.map((n) => ({
      fileName: n.fileName ?? '',
      line: n.line ?? 0,
      column: n.column,
      name: n.name,
      fullName: n.fullName,
      method: n.method,
      typeName: n.typeName
    }));
    const first = nodes[0];
    where = first?.fileName
      ? `${stripLeadingSlash(first.fileName)}${first.line ? `:${first.line}` : ''}`
      : '';
  } else if (type === 'sca') {
    const pkg = data.packageIdentifier ?? {};
    title = vd.cveName ?? data.scaType ?? 'SCA finding';
    if (pkg.name) {
      title = `${title} · ${pkg.name}${pkg.version ? `@${pkg.version}` : ''}`;
    }
    const locations = data.scaPackageData?.locations ?? [];
    const loc = Array.isArray(locations) ? locations[0] : undefined;
    where =
      loc && typeof loc === 'object' && 'path' in (loc as Record<string, unknown>)
        ? stripLeadingSlash(String((loc as Record<string, unknown>).path))
        : '';
    flow = Array.isArray(locations)
      ? locations
          .filter((l): l is { path: string; line?: number } => Boolean(l) && typeof l === 'object' && typeof l.path === 'string')
          .map((l) => ({ fileName: l.path, line: l.line ?? 0 }))
      : [];
  } else {
    // kics and others
    title = data.queryName ?? raw.label ?? 'Finding';
    where = data.filename
      ? `${stripLeadingSlash(data.filename)}${data.line ? `:${data.line}` : ''}`
      : '';
    if (data.filename) {
      flow = [{ fileName: data.filename, line: data.line ?? 0 }];
    }
  }

  const severity: Severity = normalizeSeverity(raw.severity);

  return {
    id: String(raw.id),
    vendorId: String(raw.id),
    scanId,
    projectId,
    type,
    label: raw.label ?? type,
    similarityId: String(raw.similarityId ?? ''),
    severity,
    rawSeverity: raw.severity == null ? undefined : String(raw.severity),
    state: normalizeState(raw.state),
    status: normalizeStatus(raw.status),
    created: raw.created,
    title,
    where,
    language: data.languageName,
    group: data.group,
    cwe: vd.cweId != null ? String(vd.cweId) : undefined,
    cve: vd.cveName,
    cvssScore: vd.cvssScore,
    description: stripHtml(raw.descriptionHTML || raw.description || ''),
    compliances: vd.compliances,
    flow,
    packageName: data.packageIdentifier?.name,
    packageVersion: data.packageIdentifier?.version,
    packageManager: data.packageIdentifier?.packageManager,
    recommendedVersion: data.recommendedVersion,
    isDirectDependency: data.scaPackageData?.isDirectDependency,
    dependencyPaths: normalizeDependencyPaths(data.scaPackageData?.dependencyPaths),
    redundancy: data.redundancy === 'fix' || data.redundancy === 'redundant' ? data.redundancy : undefined,
    fixLink: data.scaPackageData?.fixLink,
    comments: raw.comments
  };
}

export function normalizeFindings(raw: CxResult[], scanId: string, projectId: string): Finding[] {
  const findings = raw.map((item) => normalizeFinding(item, scanId, projectId));
  const idCounts = new Map<string, number>();
  for (const finding of findings) idCounts.set(finding.id, (idCounts.get(finding.id) ?? 0) + 1);
  const evidenceKey = (finding: Finding) => JSON.stringify([
    finding.scanId, finding.projectId, finding.type, finding.vendorId, finding.similarityId,
    finding.cve, finding.packageManager, finding.packageName, finding.packageVersion, finding.flow
  ]);
  const evidenceCounts = new Map<string, number>();
  for (const finding of findings) {
    if (idCounts.get(finding.id)! < 2) continue;
    const key = evidenceKey(finding);
    evidenceCounts.set(key, (evidenceCounts.get(key) ?? 0) + 1);
  }
  const used = new Set(findings.map((finding) => finding.id));
  const ordinals = new Map<string, number>();
  return findings.map((finding) => {
    if (idCounts.get(finding.id)! < 2) return finding;
    const evidence = evidenceKey(finding);
    const stem = `occurrence:${createHash('sha256').update(evidence).digest('hex')}`;
    let ordinal = ordinals.get(stem) ?? 0;
    let key = stem;
    while (used.has(key)) key = `${stem}:${++ordinal}`;
    ordinals.set(stem, ordinal);
    used.add(key);
    return { ...finding, id: key, identityAmbiguous: evidenceCounts.get(evidence)! > 1 || undefined };
  });
}

function normalizeDependencyPaths(raw: unknown): Finding['dependencyPaths'] {
  if (!Array.isArray(raw)) return undefined;
  const paths = raw.filter(Array.isArray).map((path) => path.filter((node) => node && typeof node === 'object').map((node: Record<string, unknown>) => ({
    id: typeof node.id === 'string' ? node.id : undefined,
    name: typeof node.name === 'string' ? node.name : undefined,
    version: typeof node.version === 'string' ? node.version : undefined,
    packageManager: typeof node.packageManager === 'string' ? node.packageManager : undefined,
    locations: Array.isArray(node.locations) ? node.locations.filter((location) => location && typeof location === 'object' && typeof location.path === 'string').map((location) => ({ path: location.path as string, line: typeof location.line === 'number' ? location.line : undefined })) : undefined
  }))).filter((path) => path.length > 0);
  return paths.length ? paths : undefined;
}

function stripLeadingSlash(p: string): string {
  return p.replace(/^\/+/, '');
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeState(raw: unknown): Finding['state'] {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'NOT_EXPLOITABLE' || s === 'NOTEXPLOITABLE') return 'NOT_EXPLOITABLE';
  if (s === 'PROPOSED_NOT_EXPLOITABLE') return 'PROPOSED_NOT_EXPLOITABLE';
  if (s === 'CONFIRMED') return 'CONFIRMED';
  if (s === 'URGENT') return 'URGENT';
  return 'TO_VERIFY';
}

export function normalizeStatus(raw: unknown): Finding['status'] {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'NEW' || s === 'RECURRENT' || s === 'FIXED' || s === 'UNCHANGED') return s;
  return 'NEW';
}
