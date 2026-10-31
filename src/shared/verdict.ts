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
  newInfo: number;
  newUnknown: number;
  totalNew: number;
  headline: string;
}

export function computeVerdict(input: VerdictInput): Verdict {
  const newCritical = input.newBySeverity.CRITICAL ?? 0;
  const newHigh = input.newBySeverity.HIGH ?? 0;
  const newMedium = input.newBySeverity.MEDIUM ?? 0;
  const newLow = input.newBySeverity.LOW ?? 0;
  const newInfo = input.newBySeverity.INFO ?? 0;
  const newUnknown = input.newBySeverity.UNKNOWN ?? 0;
  const totalNew = newCritical + newHigh + newMedium + newLow + newInfo + newUnknown;

  const blocking = newCritical + newHigh;
  const headline = blocking
    ? `${newCritical} new Critical · ${newHigh} new High since baseline`
    : newUnknown
      ? `${newUnknown} new finding${newUnknown === 1 ? '' : 's'} with unknown severity; review required`
    : totalNew
      ? `No new High/Critical — ${totalNew} lower-severity finding${totalNew === 1 ? '' : 's'}`
      : 'No new findings since baseline';

  return {
    pass: blocking === 0 && newUnknown === 0,
    newCritical,
    newHigh,
    newMedium,
    newLow,
    newInfo,
    newUnknown,
    totalNew,
    headline
  };
}
