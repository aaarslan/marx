import React from 'react';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '@shared/severity';
import type { ScanStatus, Severity } from '@shared/types';

export function restoreControlFocus(origin: HTMLElement | null) {
  const focus = (attempt: number) => {
    if (!origin?.isConnected || !origin.getClientRects().length) return;
    if (origin.matches(':disabled')) {
      if (attempt < 3) requestAnimationFrame(() => focus(attempt + 1));
      return;
    }
    origin.focus({ preventScroll: true });
  };
  requestAnimationFrame(() => focus(0));
}

export function keepDialogFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key === 'Escape') { event.stopPropagation(); return; }
  if (event.key !== 'Tab') return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
    .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}

export function Toggle({
  checked,
  onChange,
  label,
  sub,
  disabled = false,
  accessibleLabel
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  sub?: string;
  disabled?: boolean;
  accessibleLabel?: string;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        aria-label={accessibleLabel}
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="track" />
      <span>
        {label}
        {sub && <span className="sub">{sub}</span>}
      </span>
    </label>
  );
}

export function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span
      className="dot"
      style={{ background: SEVERITY_COLOR[severity], display: 'inline-block', width: 9, height: 9, borderRadius: '50%' }}
    />
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`badge sev-${severity.toLowerCase()}`} style={{ background: 'transparent', padding: 0 }}>
      <SeverityDot severity={severity} />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function StatusBadge({ status }: { status: ScanStatus }) {
  const cls = status.toLowerCase().replace(' ', '-');
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function Empty({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Banner({
  kind,
  children,
  action
}: {
  kind: 'info' | 'warn' | 'error' | 'ok';
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="grow">{children}</span>
      {action}
    </div>
  );
}

export const Spinner = ({ size = 14 }: { size?: number }) => (
  <span
    className="spin"
    style={{
      display: 'inline-block',
      width: size,
      height: size,
      border: '2px solid var(--border-strong)',
      borderTopColor: 'var(--accent)',
      borderRadius: '50%'
    }}
  />
);

export { timeAgo, formatCount } from '@shared/format';
