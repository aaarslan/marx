import type { Severity } from './types';

export const SEVERITY_ORDER: Record<Severity, number> = {
  UNKNOWN: 6,
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  UNKNOWN: 'Unknown',
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  INFO: 'Info'
};

export function normalizeSeverity(raw: unknown): Severity {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === 'CRITICAL') return 'CRITICAL';
  if (s === 'HIGH') return 'HIGH';
  if (s === 'MEDIUM') return 'MEDIUM';
  if (s === 'LOW') return 'LOW';
  if (s === 'INFO' || s === 'INFORMATION' || s === 'INFORMATIONAL') return 'INFO';
  return 'UNKNOWN';
}

export function severityRank(a: Severity, b: Severity): number {
  return SEVERITY_ORDER[b] - SEVERITY_ORDER[a];
}

export const SEVERITIES: Severity[] = ['UNKNOWN', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

/** CSS color tokens per severity (dark theme). */
export const SEVERITY_COLOR: Record<Severity, string> = {
  UNKNOWN: '#b39df5',
  CRITICAL: '#ff5c5c',
  HIGH: '#ff8a3d',
  MEDIUM: '#ffc53d',
  LOW: '#5cb85c',
  INFO: '#8b95a5'
};
