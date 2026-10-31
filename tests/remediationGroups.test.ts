import { describe, expect, it } from 'vitest';
import { groupFindings } from '../src/shared/remediationGroups';
import type { Finding } from '../src/shared/types';

function finding(id: string, extra: Partial<Finding> = {}): Finding {
  return { id, scanId: 'scan', projectId: 'project', type: 'sca', label: 'sca', similarityId: id, severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW', title: 'Vulnerability', where: 'package.json', description: '', flow: [{ fileName: 'package.json', line: 1 }], packageName: 'lib', packageVersion: '1.0.0', packageManager: 'npm', ...extra };
}

describe('remediation groups', () => {
  it('groups CVEs sharing package and dependency context while keeping all identities', () => {
    const groups = groupFindings([finding('cve1'), finding('cve2'), finding('other-version', { packageVersion: '2.0.0' })]);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.findingIds.length === 2)?.findingIds).toEqual(['cve1', 'cve2']);
    expect(groups.flatMap((group) => group.findingIds).sort()).toEqual(['cve1', 'cve2', 'other-version']);
  });

  it('keeps distinct dependency parents and manifests in separate groups', () => {
    const groups = groupFindings([
      finding('one', { dependencyPaths: [[{ name: 'parent-one' }, { name: 'lib', version: '1.0.0' }]] }),
      finding('two', { dependencyPaths: [[{ name: 'parent-two' }, { name: 'lib', version: '1.0.0' }]] }),
      finding('three', { flow: [{ fileName: 'apps/other/package.json', line: 1 }] })
    ]);
    expect(groups).toHaveLength(3);
  });

  it('groups SAST findings only with matching rule and actual shared sink evidence', () => {
    const sast = { type: 'sast', title: 'SQL Injection', flow: [{ fileName: 'source.ts', line: 1 }, { fileName: 'sink.ts', line: 20, name: 'query' }] };
    const groups = groupFindings([
      finding('one', sast), finding('two', { ...sast, redundancy: 'redundant' }),
      finding('three', { ...sast, flow: [{ fileName: 'source.ts', line: 1 }, { fileName: 'other-sink.ts', line: 20 }] })
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].findingIds).toEqual(['one', 'two']);
    expect(groups[0].rationale).toContain('not proof');
  });

  it('never groups by redundancy label alone or across projects', () => {
    const groups = groupFindings([
      finding('one', { type: 'sast', flow: [], redundancy: 'redundant' }),
      finding('two', { type: 'sast', flow: [], redundancy: 'redundant' }),
      finding('three', { projectId: 'other-project' }), finding('four')
    ]);
    expect(groups).toHaveLength(4);
  });

  it('surfaces unknown severity without representing it as low risk', () => {
    const group = groupFindings([finding('known'), finding('unknown', { severity: 'UNKNOWN' })])[0];
    expect(group.severity).toBe('UNKNOWN');
    expect(group.findingIds).toEqual(['known', 'unknown']);
  });
});
