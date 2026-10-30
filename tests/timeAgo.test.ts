import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeAgo } from '../src/shared/format';

afterEach(() => vi.useRealTimers());

describe('scan timestamps', () => {
  it('shows unavailable for missing or malformed timestamps', () => {
    expect(timeAgo('')).toBe('—');
    expect(timeAgo('not-a-date')).toBe('—');
  });

  it('distinguishes a future scan from a recently completed scan', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
    expect(timeAgo('2026-10-29T11:59:45Z')).toBe('just now');
    expect(timeAgo('2026-10-29T12:00:15Z')).toBe('in a moment');
    expect(timeAgo('2026-10-30T12:00:00Z')).not.toBe('just now');
    expect(timeAgo('2026-10-30T12:00:00Z')).not.toMatch(/NaN|undefined/);
  });
});
