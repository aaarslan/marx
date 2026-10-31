import { describe, expect, it } from 'vitest';
import { compareScans, verifySelectedFindings } from '../src/shared/comparison';
import type { Finding, ResultsPage, Severity } from '../src/shared/types';
import type { ScanProvenance } from '../src/shared/workbench';

function finding(id: string, severity: Severity = 'HIGH', extra: Partial<Finding> = {}): Finding {
  return { id, scanId: '', projectId: 'p', type: 'sast', label: 'sast', similarityId: id, severity, state: 'TO_VERIFY', status: 'NEW', title: 'SQL Injection', where: 'src/app.ts:1', description: '', flow: [], ...extra };
}

function provenance(): ScanProvenance {
  return {
    version: 1, connectionId: 'tenant', capturedAt: 1,
    source: { folderPath: '/repo', branch: 'main', dirty: false, fingerprint: 'source', capturedAt: 1, snapshot: true },
    options: { scanners: ['sast'], branch: 'main', sastPreset: 'Default', sastIncremental: false, scaExploitablePath: false, excludes: ['node_modules'], tags: {} },
    optionsFingerprint: 'request', requestedScanners: ['sast'], completedScanners: ['sast'], effectiveConfigFingerprint: 'server-config'
  };
}

function page(id: 'before' | 'after', findings: Finding[]): ResultsPage {
  return {
    connectionId: 'tenant', provenance: provenance(),
    scan: { id, projectId: 'p', projectName: 'project', branch: 'main', status: 'Completed', createdAt: id === 'before' ? '2026-01-01T00:00:00Z' : '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
    findings: findings.map((item) => ({ ...item, scanId: id })), totalCount: findings.length, truncated: false
  };
}

describe('scan comparison', () => {
  it('uses scanner identities across line shifts and detects severity escalation', () => {
    const before = page('before', [finding('old', 'MEDIUM', { similarityId: 'stable' })]);
    const after = page('after', [finding('new', 'HIGH', { similarityId: 'stable', where: 'src/app.ts:100' })]);
    const comparison = compareScans(before, after);
    expect(comparison.compatibility).toBe('comparable');
    expect(comparison.changes.new).toBe('ESCALATED');
    expect(comparison.newCount).toBe(0);
    expect(comparison.escalatedCount).toBe(1);
    expect(comparison.verdict).toBe('attention');
  });

  it('keeps INFO in totals while retaining the new High/Critical policy', () => {
    const comparison = compareScans(page('before', []), page('after', [finding('info', 'INFO')]));
    expect(comparison.verdict).toBe('pass');
    expect(comparison.newCount).toBe(1);
    expect(comparison.newBySeverity.INFO).toBe(1);
    expect(comparison.headline).not.toContain('No new findings');
  });

  it('does not infer effective server settings from matching local requests', () => {
    const before = page('before', []);
    const after = page('after', []);
    delete before.provenance!.effectiveConfigFingerprint;
    delete after.provenance!.effectiveConfigFingerprint;
    const comparison = compareScans(before, after);
    expect(comparison.compatibility).toBe('inconclusive');
    expect(comparison.verdict).toBe('inconclusive');
    expect(comparison.reasons.join(' ')).toContain('Effective server configuration');
  });

  it('still calls attention to an observed new High while configuration is unverified', () => {
    const before = page('before', []);
    const after = page('after', [finding('new')]);
    delete after.provenance!.effectiveConfigFingerprint;
    const comparison = compareScans(before, after);
    expect(comparison.compatibility).toBe('inconclusive');
    expect(comparison.verdict).toBe('attention');
    expect(comparison.headline).toContain('unverified');
  });

  it('does not infer engine completion or source integrity from Completed', () => {
    const after = page('after', []);
    delete after.provenance!.completedScanners;
    after.provenance!.source.snapshot = false;
    const comparison = compareScans(page('before', []), after);
    expect(comparison.verdict).toBe('inconclusive');
    expect(comparison.reasons.join(' ')).toContain('Successful engine coverage');
    expect(comparison.reasons.join(' ')).toContain('live folder');
  });

  it('shows absent findings as evidence while incompatible configuration prevents passing', () => {
    const before = page('before', [finding('old')]);
    const after = page('after', []);
    after.provenance!.effectiveConfigFingerprint = 'different-server-config';
    const comparison = compareScans(before, after);
    expect(comparison.absent.map((item) => item.id)).toEqual(['old']);
    expect(comparison.compatibility).toBe('incompatible');
    expect(comparison.verdict).toBe('inconclusive');
    expect(comparison.reasons.join(' ')).toContain('may not have been evaluated');
  });

  it('does not declare new or absent findings against a partial baseline', () => {
    const before = page('before', [finding('old')]);
    before.totalCount = 200;
    before.truncated = true;
    const comparison = compareScans(before, page('after', [finding('new')]));
    expect(comparison.changes.new).toBe('UNCERTAIN');
    expect(comparison.newCount).toBe(0);
    expect(comparison.absent).toEqual([]);
    expect(comparison.verdict).toBe('inconclusive');
  });

  it('does not collapse multiple occurrences sharing a similarity family', () => {
    const before = page('before', [finding('one', 'HIGH', { similarityId: 'family' }), finding('two', 'HIGH', { similarityId: 'family' })]);
    const comparison = compareScans(before, page('after', [finding('three', 'HIGH', { similarityId: 'family' })]));
    expect(comparison.changes.three).toBe('UNCERTAIN');
    expect(comparison.persistentCount).toBe(0);
    expect(comparison.absent).toEqual([]);
    expect(comparison.verdict).toBe('inconclusive');
  });

  it('does not match missing identities by identical title or location', () => {
    const comparison = compareScans(page('before', [finding('one', 'HIGH', { similarityId: '' })]), page('after', [finding('two', 'HIGH', { similarityId: '' })]));
    expect(comparison.changes.two).toBe('UNCERTAIN');
    expect(comparison.newCount).toBe(0);
    expect(comparison.absent).toEqual([]);
  });

  it('namespaces SCA identity by package and version instead of CVE alone', () => {
    const pkg = { type: 'sca', cve: 'CVE-2026-1234', packageName: 'lib', packageVersion: '1.0.0', packageManager: 'npm' };
    const comparison = compareScans(page('before', [finding('old', 'HIGH', pkg)]), page('after', [finding('new', 'HIGH', { ...pkg, packageVersion: '2.0.0' })]));
    expect(comparison.changes.new).toBe('NEW');
    expect(comparison.absent.map((item) => item.id)).toEqual(['old']);
  });

  it('blocks a passing verdict for unknown severity or discarded records', () => {
    const after = page('after', [finding('unknown', 'UNKNOWN')]);
    expect(compareScans(page('before', []), after).verdict).toBe('inconclusive');
    const discarded = page('after', []);
    discarded.counts = { reported: 1, received: 1, normalized: 0, unsupported: 1 };
    expect(compareScans(page('before', []), discarded).verdict).toBe('inconclusive');
  });

  it('does not treat a synthetic local occurrence key as cross-scan proof', () => {
    const comparison = compareScans(page('before', [finding('local-old', 'HIGH', { similarityId: 'shared', identityAmbiguous: true })]), page('after', [finding('local-new', 'HIGH', { similarityId: 'shared', identityAmbiguous: true })]));
    expect(comparison.changes['local-new']).toBe('UNCERTAIN');
    expect(comparison.verdict).toBe('inconclusive');
    expect(comparison.absent).toEqual([]);
  });

  it('does not verify an SCA vulnerability merely because its package version or severity changed', () => {
    const pkg = { type: 'sca', cve: 'CVE-2026-1234', packageName: 'lib', packageVersion: '1.0.0', packageManager: 'npm' };
    const before = page('before', [finding('old', 'HIGH', pkg)]);
    const after = page('after', [finding('new', 'MEDIUM', { ...pkg, packageVersion: '2.0.0' })]);
    const comparison = compareScans(before, after);
    expect(comparison.absent.map((item) => item.id)).toEqual(['old']);
    expect(verifySelectedFindings(before, after, ['old'], comparison)).toEqual({ remainingIds: ['old'], absentIds: [] });
  });

  it('keeps verification unresolved when a current package risk is missing its vulnerability identity', () => {
    const pkg = { type: 'sca', cve: 'CVE-2026-1234', packageName: 'lib', packageVersion: '1.0.0', packageManager: 'npm' };
    const before = page('before', [finding('old', 'HIGH', pkg)]);
    const after = page('after', [finding('new', 'MEDIUM', { ...pkg, cve: undefined, packageVersion: '2.0.0' })]);
    expect(verifySelectedFindings(before, after, ['old'], compareScans(before, after))).toEqual({ remainingIds: ['old'], absentIds: [] });
  });

  it('records selected absence when the target vulnerability is no longer present', () => {
    const before = page('before', [finding('old')]);
    const after = page('after', []);
    expect(verifySelectedFindings(before, after, ['old'], compareScans(before, after))).toEqual({ remainingIds: [], absentIds: ['old'] });
  });

  it('cannot pass an empty scan from a different local repository scope', () => {
    const before = page('before', [finding('old')]);
    const after = page('after', []);
    after.provenance!.source.folderPath = '/unrelated-repo';
    const comparison = compareScans(before, after);
    expect(comparison.verdict).toBe('inconclusive');
    expect(comparison.reasons.join(' ')).toContain('repository scope');
  });

  it('rejects cross-connection comparisons and mismatched enclosed finding provenance', () => {
    const before = page('before', [finding('same')]);
    const after = page('after', [finding('same')]);
    after.connectionId = 'other-tenant';
    let comparison = compareScans(before, after);
    expect(comparison.compatibility).toBe('incompatible');
    expect(comparison.changes.same).toBe('UNCERTAIN');
    after.connectionId = 'tenant';
    after.findings[0].scanId = 'another-scan';
    comparison = compareScans(before, after);
    expect(comparison.verdict).toBe('inconclusive');
    expect(comparison.changes.same).toBe('UNCERTAIN');
  });
});
