import { describe, expect, it } from 'vitest';
import { normalizeFinding, normalizeFindings, normalizeState, normalizeStatus } from '../src/main/cxone/normalize';
import type { CxResult } from '../src/main/cxone/types';

describe('normalizeFinding', () => {
  it('maps a SAST result with a flow', () => {
    const raw: CxResult = {
      id: '13588362',
      type: 'sast',
      similarityId: '1959005240',
      status: 'NEW',
      state: 'TO_VERIFY',
      severity: 'HIGH',
      descriptionHTML: 'Stored XSS <b>danger</b><br/>Second line',
      vulnerabilityDetails: { cweId: 79, compliances: ['OWASP Top 10 2021'] },
      data: {
        queryName: 'Client_DOM_Stored_XSS',
        group: 'JavaScript_High_Risk',
        languageName: 'JavaScript',
        nodes: [
          { fileName: '/src/app.jsx', line: 10, column: 5, name: 'req.body.q' },
          { fileName: '/src/render.jsx', line: 88, name: 'innerHTML' }
        ]
      }
    };
    const f = normalizeFinding(raw, 'scan-1', 'proj-1');
    expect(f.type).toBe('sast');
    expect(f.title).toBe('Client_DOM_Stored_XSS');
    expect(f.severity).toBe('HIGH');
    expect(f.state).toBe('TO_VERIFY');
    expect(f.where).toBe('src/app.jsx:10');
    expect(f.flow).toHaveLength(2);
    expect(f.flow[0].line).toBe(10);
    expect(f.cwe).toBe('79');
    expect(f.compliances).toEqual(['OWASP Top 10 2021']);
    expect(f.description).toContain('Stored XSS danger');
    expect(f.description).toContain('Second line');
    expect(f.description).not.toContain('<');
  });

  it('maps an SCA result with package info', () => {
    const raw: CxResult = {
      id: 'CVE-2021-23337',
      type: 'sca',
      similarityId: 'abc',
      status: 'NEW',
      state: 'TO_VERIFY',
      severity: 'HIGH',
      vulnerabilityDetails: { cveName: 'CVE-2021-23337', cvssScore: 7.2, cweId: 'CWE-502' },
      data: {
        scaType: 'Vulnerability',
        packageIdentifier: { name: 'lodash', version: '4.17.20' },
        recommendedVersion: '4.17.21',
        scaPackageData: {
          isDirectDependency: true,
          fixLink: 'https://nvd.nist.gov/vuln/detail/CVE-2021-23337',
          locations: [{ path: 'package.json', line: 12 }]
        }
      }
    };
    const f = normalizeFinding(raw, 'scan-1', 'proj-1');
    expect(f.title).toBe('CVE-2021-23337 · lodash@4.17.20');
    expect(f.packageName).toBe('lodash');
    expect(f.recommendedVersion).toBe('4.17.21');
    expect(f.isDirectDependency).toBe(true);
    expect(f.where).toBe('package.json');
    expect(f.cvssScore).toBe(7.2);
  });

  it('maps a KICS result', () => {
    const raw: CxResult = {
      id: '1',
      type: 'kics',
      severity: 'MEDIUM',
      state: 'TO_VERIFY',
      data: { queryName: 'Missing User Instruction', filename: '/Dockerfile', line: 1, platform: 'Dockerfile' }
    };
    const f = normalizeFinding(raw, 's', 'p');
    expect(f.title).toBe('Missing User Instruction');
    expect(f.where).toBe('Dockerfile:1');
  });

  it('is defensive with missing data', () => {
    const f = normalizeFinding({ id: '9', type: 'sast', severity: 'weird' }, 's', 'p');
    expect(f.severity).toBe('UNKNOWN');
    expect(f.rawSeverity).toBe('weird');
    expect(f.title).toBe('SAST finding');
    expect(f.flow).toEqual([]);
  });

  it('preserves explicit informational severity, redundancy and dependency paths', () => {
    const raw: CxResult = { id: 'r', type: 'sca', severity: 'Information', data: {
      redundancy: 'redundant',
      scaPackageData: { dependencyPaths: [[{ name: 'parent', version: '2.0.0' }, { name: 'child', version: '1.0.0' }]] }
    } };
    const result = normalizeFinding(raw, 's', 'p');
    expect(result.severity).toBe('INFO');
    expect(result.rawSeverity).toBe('Information');
    expect(result.redundancy).toBe('redundant');
    expect(result.dependencyPaths?.[0].map((node) => node.name)).toEqual(['parent', 'child']);
    expect(normalizeFinding({ id: 'r', type: 'sast' }, 's', 'p').severity).toBe('UNKNOWN');
  });

  it('normalizes states and statuses', () => {
    expect(normalizeState('TO_VERIFY')).toBe('TO_VERIFY');
    expect(normalizeState('NOT_EXPLOITABLE')).toBe('NOT_EXPLOITABLE');
    expect(normalizeState('PROPOSED_NOT_EXPLOITABLE')).toBe('PROPOSED_NOT_EXPLOITABLE');
    expect(normalizeState(undefined)).toBe('TO_VERIFY');
    expect(normalizeStatus('RECURRENT')).toBe('RECURRENT');
    expect(normalizeStatus('junk')).toBe('NEW');
  });

  it('retains duplicate CVE records across packages as distinct local selections', () => {
    const results: CxResult[] = ['one', 'two'].map((name) => ({
      id: 'CVE-2026-1234', type: 'sca', severity: 'HIGH', vulnerabilityDetails: { cveName: 'CVE-2026-1234' },
      data: { packageIdentifier: { name, version: '1.0.0', packageManager: 'npm' } }
    }));
    const findings = normalizeFindings(results, 'scan', 'project');
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(2);
    expect(findings.map((finding) => finding.vendorId)).toEqual(['CVE-2026-1234', 'CVE-2026-1234']);
    expect(findings.every((finding) => !finding.identityAmbiguous)).toBe(true);
    expect(normalizeFindings([...results].reverse(), 'scan', 'project').map((finding) => finding.id)).toEqual([...findings].reverse().map((finding) => finding.id));
  });

  it('preserves exact duplicate vendor records without inventing cross-scan occurrence identity', () => {
    const raw: CxResult = { id: 'same', type: 'sast', similarityId: 'family', severity: 'HIGH', data: { queryName: 'Query' } };
    const findings = normalizeFindings([raw, raw], 'scan', 'project');
    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(2);
    expect(findings.every((finding) => finding.vendorId === 'same' && finding.identityAmbiguous)).toBe(true);
    expect(normalizeFinding(raw, 'scan', 'project').id).toBe('same');
  });
});
