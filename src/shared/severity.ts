import type { Severity } from './types';

export const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  INFO: 'Info'
};

export function normalizeSeverity(raw: unknown): Severity {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'CRITICAL') return 'CRITICAL';
  if (s === 'HIGH') return 'HIGH';
  if (s === 'MEDIUM') return 'MEDIUM';
  if (s === 'LOW') return 'LOW';
  return 'INFO';
}

export function severityRank(a: Severity, b: Severity): number {
  return SEVERITY_ORDER[b] - SEVERITY_ORDER[a];
}

export const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

/** CSS color tokens per severity (dark theme). */
export const SEVERITY_COLOR: Record<Severity, string> = {
  CRITICAL: '#ff5c5c',
  HIGH: '#ff8a3d',
  MEDIUM: '#ffc53d',
  LOW: '#5cb85c',
  INFO: '#8b95a5'
};
