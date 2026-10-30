import type { Severity } from './types';

export interface VerdictInput {
  /** severity → count of NEW findings since the baseline scan */
  newBySeverity: Partial<Record<Severity, number>>;
}

export interface Verdict {
  pass: boolean;
  newCritical: number;
  newHigh: number;
  newMedium: number;
  newLow: number;
  totalNew: number;
  headline: string;
}

/**
 * Story-check gate: a story "needs attention" when it introduces any new
 * High or Critical finding. Medium/Low are reported for awareness but don't
 * fail the check — matching how most teams gate merges in CI.
 */
export function computeVerdict(input: VerdictInput): Verdict {
  const newCritical = input.newBySeverity.CRITICAL ?? 0;
  const newHigh = input.newBySeverity.HIGH ?? 0;
  const newMedium = input.newBySeverity.MEDIUM ?? 0;
  const newLow = input.newBySeverity.LOW ?? 0;
  const totalNew = newCritical + newHigh + newMedium + newLow;

  const blocking = newCritical + newHigh;
  const headline = blocking
    ? `${newCritical} new Critical · ${newHigh} new High since baseline`
    : totalNew
      ? `No new High/Critical — ${totalNew} lower-severity finding${totalNew === 1 ? '' : 's'}`
      : 'No new findings since baseline';

  return {
    pass: blocking === 0,
    newCritical,
    newHigh,
    newMedium,
    newLow,
    totalNew,
    headline
  };
}
