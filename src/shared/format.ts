const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });

export function timeAgo(iso: string): string {
  if (!iso) return '—';
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return '—';
  const seconds = (timestamp - Date.now()) / 1000;
  if (Math.abs(seconds) < 60) return seconds > 0 ? 'in a moment' : 'just now';
  for (const [unit, duration] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(seconds) >= duration) return relativeFormat.format(Math.trunc(seconds / duration), unit);
  }
  return 'just now';
}

const countFormat = new Intl.NumberFormat();
export const formatCount = (value: number): string => Number.isFinite(value) && value >= 0 ? countFormat.format(value) : '—';
