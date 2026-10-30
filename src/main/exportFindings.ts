import type { Finding } from '@shared/types';

export interface ExportPayload {
  format: 'csv' | 'json';
  /** used for the filename, e.g. "shop-frontend a1b2c3" */
  label: string;
  findings: Finding[];
}

export function safeFileName(label: string): string {
  return (
    label
      .trim()
      .replace(/[/:?*"<>|\\]/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'findings'
  );
}

const CSV_COLUMNS: (keyof Finding | 'cweCve')[] = [
  'severity',
  'state',
  'status',
  'type',
  'title',
  'where',
  'group',
  'language',
  'cweCve',
  'cvssScore',
  'packageName',
  'packageVersion',
  'recommendedVersion',
  'similarityId',
  'description'
] as const;

function cweCve(f: Finding): string {
  if (f.cve) return f.cve;
  if (f.cwe) return `CWE-${String(f.cwe).replace(/^CWE-?/i, '')}`;
  return '';
}

function csvCell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  const s = typeof value === 'string' && /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  // wrap when needed; double up embedded quotes
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(findings: Finding[]): string {
  const header = CSV_COLUMNS.map((c) => (c === 'cweCve' ? 'cve_cwe' : c)).join(',');
  const rows = findings.map((f) =>
    CSV_COLUMNS.map((c) => csvCell(c === 'cweCve' ? cweCve(f) : f[c as keyof Finding])).join(',')
  );
  return [header, ...rows].join('\r\n');
}

export function buildJson(findings: Finding[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      totalCount: findings.length,
      severityCounts: countSeverities(findings),
      findings
    },
    null,
    2
  );
}

function countSeverities(findings: Finding[]): Record<string, number> {
  const out: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  for (const f of findings) out[f.severity] = (out[f.severity] ?? 0) + 1;
  return out;
}
