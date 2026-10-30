import { describe, expect, it } from 'vitest';
import { buildCsv, buildJson, safeFileName } from '../src/main/exportFindings';
import type { Finding } from '../src/shared/types';

const base: Finding = {
  id: '1',
  scanId: 's',
  projectId: 'p',
  type: 'sast',
  label: 'sast',
  similarityId: 'sim-1',
  severity: 'HIGH',
  state: 'TO_VERIFY',
  status: 'NEW',
  title: 'Stored_XSS',
  where: 'src/app.jsx:42',
  group: 'JavaScript_High_Risk',
  language: 'JavaScript',
  cwe: '79',
  description: 'desc',
  flow: []
};

describe('export builders', () => {
  it('neutralizes formula-like CSV strings', () => {
    expect(buildCsv([{ ...base, title: '=1+1', description: '  @SUM(1)' }])).toContain("'=1+1");
    expect(buildCsv([{ ...base, title: '=1+1', description: '  @SUM(1)' }])).toContain("'  @SUM(1)");
  });
  it('escapes CSV cells with quotes, commas and newlines', () => {
    const f: Finding = {
      ...base,
      title: 'Injection, "dangerous" title',
      description: 'line1\nline2'
    };
    const csv = buildCsv([f]);
    expect(csv.split('\r\n')[0]).toContain('cve_cwe');
    expect(csv).toContain('"Injection, ""dangerous"" title"');
    expect(csv).toContain('"line1\nline2"');
  });

  it('uses cve when present, cwe otherwise', () => {
    const csv = buildCsv([
      { ...base, cve: 'CVE-2021-23337' },
      { ...base, id: '2', cve: undefined }
    ]);
    expect(csv).toContain('CVE-2021-23337');
    expect(csv).toContain('CWE-79');
  });

  it('includes SCA package columns', () => {
    const csv = buildCsv([
      {
        ...base,
        id: '3',
        type: 'sca',
        title: 'CVE-2021-23337 · lodash@4.17.20',
        packageName: 'lodash',
        packageVersion: '4.17.20',
        recommendedVersion: '4.17.21'
      }
    ]);
    expect(csv).toContain('lodash');
    expect(csv).toContain('4.17.20');
    expect(csv).toContain('4.17.21');
  });

  it('builds JSON with severity counts', () => {
    const parsed = JSON.parse(
      buildJson([base, { ...base, id: '2', severity: 'CRITICAL' }])
    );
    expect(parsed.totalCount).toBe(2);
    expect(parsed.severityCounts.CRITICAL).toBe(1);
    expect(parsed.severityCounts.HIGH).toBe(1);
    expect(parsed.findings[0].title).toBe('Stored_XSS');
  });

  it('sanitizes file names', () => {
    expect(safeFileName('shop/frontend: a1?b*')).toBe('shop-frontend--a1-b-');
    expect(safeFileName('   ')).toBe('findings');
  });
});
