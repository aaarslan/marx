import { describe, expect, it } from 'vitest';
import { baselineCandidates } from '../src/shared/baseline';
import type { ScanHistoryItem } from '../src/shared/types';

const current: ScanHistoryItem = { id: 'current', projectId: 'p1', projectName: 'UI', branch: 'feature', status: 'Completed', createdAt: '2026-10-30T12:00:00Z', updatedAt: '' };
const earlier = { ...current, id: 'earlier', createdAt: '2026-10-29T12:00:00Z' };

describe('explicit comparison scope', () => {
  it('defaults to completed older scans on the same project and branch', () => {
    const scans = [current, earlier, { ...earlier, id: 'other', branch: 'main' }, { ...earlier, id: 'wrong', projectId: 'p2' }, { ...earlier, id: 'failed', status: 'Failed' as const }, { ...earlier, id: 'unknown-date', createdAt: '' }, { ...earlier, id: 'later', createdAt: '2026-10-31T12:00:00Z' }];
    expect(baselineCandidates(current, scans).map((scan) => scan.id)).toEqual(['earlier']);
    expect(baselineCandidates(current, scans, true).map((scan) => scan.id)).toEqual(['earlier', 'other']);
  });

  it('requires known project, branch and creation time even with cross-branch opt-in', () => {
    expect(baselineCandidates(undefined, [earlier])).toEqual([]);
    expect(baselineCandidates({ ...current, status: 'Failed' }, [earlier])).toEqual([]);
    expect(baselineCandidates({ ...current, projectId: '' }, [earlier], true)).toEqual([]);
    expect(baselineCandidates({ ...current, branch: '' }, [earlier], true)).toEqual([]);
    expect(baselineCandidates({ ...current, createdAt: '' }, [earlier], true)).toEqual([]);
  });
});
