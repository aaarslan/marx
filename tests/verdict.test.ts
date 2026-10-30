import { describe, expect, it } from 'vitest';
import { computeVerdict } from '../src/shared/verdict';

describe('computeVerdict (story-check gate)', () => {
  it('passes when nothing new was introduced', () => {
    const v = computeVerdict({ newBySeverity: {} });
    expect(v.pass).toBe(true);
    expect(v.totalNew).toBe(0);
    expect(v.headline).toContain('No new findings');
  });

  it('passes with only lower-severity new findings', () => {
    const v = computeVerdict({ newBySeverity: { MEDIUM: 3, LOW: 2 } });
    expect(v.pass).toBe(true);
    expect(v.totalNew).toBe(5);
    expect(v.headline).toContain('5 lower-severity');
  });

  it('fails on any new Critical', () => {
    const v = computeVerdict({ newBySeverity: { CRITICAL: 1, MEDIUM: 4 } });
    expect(v.pass).toBe(false);
    expect(v.headline).toBe('1 new Critical · 0 new High since baseline');
  });

  it('fails on new High findings', () => {
    const v = computeVerdict({ newBySeverity: { HIGH: 2 } });
    expect(v.pass).toBe(false);
    expect(v.headline).toBe('0 new Critical · 2 new High since baseline');
  });

  it('aggregates blocking severities', () => {
    const v = computeVerdict({ newBySeverity: { CRITICAL: 2, HIGH: 3, LOW: 1 } });
    expect(v.pass).toBe(false);
    expect(v.totalNew).toBe(6);
  });
});
