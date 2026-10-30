import { folderName } from '@shared/path';
import React, { useEffect, useState } from 'react';
import { FolderOpen, UploadCloud, Check, ArrowUpRight } from 'lucide-react';
import type { ScanJobState, ScanOptions, ScannerType } from '@shared/types';
import { api, commandKey } from '../api';
import { Toggle, formatCount } from './ui';

export function Dropzone({
  folder,
  onPick,
  hint
}: {
  folder: string | null;
  onPick: (path: string) => void;
  hint: string;
}) {
  const [over, setOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  return (
    <button
      type="button"
      className={`dropzone ${over ? 'over' : ''} ${folder ? 'has-folder' : ''}`}
      aria-label={folder ? `Change project folder: ${folder}` : 'Choose a project folder'}
      onClick={async () => {
        setDropError(null);
        try { const folder = await api.dialog.selectFolder(); if (folder) onPick(folder); }
        catch (e) { setDropError(e instanceof Error ? e.message : String(e)); }
      }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        setDropError(null);
        const file = e.dataTransfer.files[0];
        try {
          if (file) { const path = await api.fs.pathForFile(file); if (path) onPick(path); }
        } catch (error) { setDropError(error instanceof Error ? error.message : String(error)); }
      }}
    >
      <span className="dropzone-topline"><span>{folder ? 'Source folder' : 'Local source'}</span><kbd>{commandKey}O</kbd></span>
      <span className="dropzone-symbol">{folder ? <FolderOpen size={26} strokeWidth={1.5} /> : <UploadCloud size={28} strokeWidth={1.5} />}</span>
      <strong>{folder ? folderName(folder) : 'Choose a project folder'}</strong>
      <span className="dropzone-hint">{folder ? folder : 'Drop a folder here, or browse your computer.'}</span>
      <span className="dropzone-action">{folder ? 'Change folder' : 'Browse folders'}<ArrowUpRight size={13} aria-hidden="true" /></span>
      <span className="dropzone-caption">{hint}</span>
      {dropError && <span className="dropzone-error" role="alert">{dropError}</span>}
    </button>
  );
}

export function ScannerToggles({
  scanners,
  onChange
}: {
  scanners: ScannerType[];
  onChange: (s: ScannerType[]) => void;
}) {
  const flip = (t: ScannerType) =>
    onChange(scanners.includes(t) ? scanners.filter((x) => x !== t) : [...scanners, t]);
  return (
    <div className="scanner-grid">
      <div
        className={`scanner-card ${scanners.includes('sast') ? 'selected' : ''}`}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('.toggle')) flip('sast'); }}
      >
        <div className="head">
          SAST
          <span className="badge completed" style={{ fontSize: 10 }}>
            code
          </span>
        </div>
        <div className="desc">
          Static analysis of your proprietary code — injections, XSS, secrets in logic, misconfigurations.
        </div>
        <Toggle
          checked={scanners.includes('sast')}
          onChange={() => flip('sast')}
          label={scanners.includes('sast') ? 'Enabled' : 'Disabled'}
        />
      </div>
      <div
        className={`scanner-card ${scanners.includes('sca') ? 'selected' : ''}`}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('.toggle')) flip('sca'); }}
      >
        <div className="head">
          SCA
          <span className="badge queued" style={{ fontSize: 10 }}>
            deps
          </span>
        </div>
        <div className="desc">
          Software composition analysis — vulnerable & malicious open-source packages, license risks.
        </div>
        <Toggle
          checked={scanners.includes('sca')}
          onChange={() => flip('sca')}
          label={scanners.includes('sca') ? 'Enabled' : 'Disabled'}
        />
      </div>
    </div>
  );
}

export function ScanOptionsEditor({
  options,
  onChange
}: {
  options: ScanOptions;
  onChange: (patch: Partial<ScanOptions>) => void;
}) {
  return (
    <>
      <div className="section-title">Scanners</div>
      <ScannerToggles
        scanners={options.scanners}
        onChange={(scanners) => onChange({ scanners })}
      />

      {options.scanners.includes('sast') && (
        <>
          <div className="section-title">SAST</div>
          <div className="grid-2">
            <label className="field">
              Query preset
              <input
                type="text"
                value={options.sastPreset}
                onChange={(e) => onChange({ sastPreset: e.target.value })}
                placeholder="Checkmarx Default"
                list="preset-suggestions"
              />
              <datalist id="preset-suggestions">
                <option value="Checkmarx Default" />
                <option value="ASA Premium" />
                <option value="OWASP Top 10 2021" />
                <option value="PCI DSS v3.2.1" />
                <option value="CWE Top 25 2022" />
              </datalist>
            </label>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap' }}>
              <Toggle
                checked={options.sastIncremental}
                onChange={(sastIncremental) => onChange({ sastIncremental })}
                label="Incremental"
                sub="only changed code (needs a previous full scan)"
              />
            </div>
          </div>
        </>
      )}

      {options.scanners.includes('sca') && (
        <>
          <div className="section-title">SCA</div>
          <Toggle
            checked={options.scaExploitablePath}
            onChange={(scaExploitablePath) => onChange({ scaExploitablePath })}
            label="Exploitable Path"
            sub="reachability analysis — verifies your code actually calls the vulnerable method (Java, JS, Python, C#; slower)"
          />
        </>
      )}

      <div className="section-title">Excludes</div>
      <label className="field">
        Folders / files to skip (one per line). Add <span className="mono">!name</span> to re-include a default.
        <textarea
          rows={3}
          value={options.excludes.join('\n')}
          onChange={(e) =>
            onChange({ excludes: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })
          }
          placeholder="e.g. e2e-fixtures"
          style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}
        />
      </label>
      <div className="faint" style={{ fontSize: 11 }}>
        Always excluded: .git, node_modules, dist, build, coverage and other build noise.
      </div>

      <div className="section-title">Tags</div>
      <label className="field">
        Tags applied to the scan (<span className="mono">key:value</span>, comma-separated)
        <input
          type="text"
          placeholder="team:frontend, tier:critical"
          value={Object.entries(options.tags)
            .map(([k, v]) => `${k}:${v}`)
            .join(', ')}
          onChange={(e) => {
            const tags: Record<string, string> = {};
            for (const pair of e.target.value.split(',')) {
              const [k, ...rest] = pair.split(':');
              const key = k.trim();
              if (key) tags[key] = rest.join(':').trim();
            }
            onChange({ tags });
          }}
        />
      </label>
    </>
  );
}

const PHASES: { id: string; label: string }[] = [
  { id: 'resolving-project', label: 'Project' },
  { id: 'zipping', label: 'Zip' },
  { id: 'uploading', label: 'Upload' },
  { id: 'queued', label: 'Queue' },
  { id: 'running', label: 'Scan' },
  { id: 'fetching-results', label: 'Results' }
];

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export function ProgressCard({
  job,
  onCancel,
  onViewResults
}: {
  job: ScanJobState;
  onCancel: () => void;
  onViewResults: () => void;
}) {
  const phaseIdx = job.progress.phase === 'completed' ? PHASES.length : PHASES.findIndex((p) => p.id === job.progress.phase);
  const terminal =
    job.progress.phase === 'completed' || job.progress.phase === 'failed' || job.progress.phase === 'canceled';

  // live elapsed timer
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (terminal) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [terminal]);
  const elapsed = fmtElapsed((job.finishedAt ?? now) - job.startedAt);

  return (
    <div className={`progress-card ${terminal ? 'settled' : ''} ${job.progress.phase}`}>
      <div className="row between">
        <div className="row">
          <strong>{job.projectName}</strong>
          <span className="dim mono">{job.branch}</span>
          {job.scanId && <span className="faint mono">#{job.scanId.slice(0, 8)}</span>}
          <span className="faint mono">{elapsed}</span>
        </div>
        <div className="row">
          {job.progress.phase === 'completed' && (
            <button className="btn primary small" onClick={onViewResults}>
              View results
            </button>
          )}
          {!terminal && (
            <button className="btn small" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <div
        className="progress-track"
        role="progressbar"
        aria-label={terminal ? `Scan ${job.progress.phase}` : `Scan ${job.progress.phase.replaceAll('-', ' ')}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={job.progress.phase === 'completed' ? 100 : job.progress.percent}
      >
        <div
          className={`progress-fill ${!terminal && job.progress.percent == null ? 'indeterminate' : ''}`}
          style={{ transform: terminal ? 'scaleX(1)' : job.progress.percent == null ? undefined : `scaleX(${Math.max(0, Math.min(100, job.progress.percent)) / 100})` }}
        />
      </div>
      <div className="phase-steps" aria-label="Scan stages">
        {PHASES.map((p, i) => (
          <span key={p.id} className={`phase-step ${i < phaseIdx ? 'done' : i === phaseIdx ? 'active' : ''}`} aria-current={i === phaseIdx ? 'step' : undefined}>
            <span className="phase-number">{i < phaseIdx ? <Check size={10} /> : i + 1}</span>{p.label}
          </span>
        ))}
      </div>
      {terminal && <div className="scan-outcome" role="status">{job.progress.phase === 'completed' ? (job.status === 'Partial' ? 'Scan finished with partial results' : 'Scan complete') : job.progress.phase === 'failed' ? 'Scan could not finish' : 'Scan canceled'}</div>}

      {job.progress.detail && (
        <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          {job.progress.detail}
        </div>
      )}

      {job.error && (
        <div className="banner error" style={{ marginTop: 12 }}>
          {job.error}
        </div>
      )}

      {job.summary && (
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <SeveritySummaryCounts summary={job.summary} />
        </div>
      )}
    </div>
  );
}

export function SeveritySummaryCounts({ summary }: { summary: ScanJobState['summary'] }) {
  if (!summary) return null;
  const items: [string, number, string][] = [
    ['Critical', summary.CRITICAL, 'var(--critical)'],
    ['High', summary.HIGH, 'var(--high)'],
    ['Medium', summary.MEDIUM, 'var(--medium)'],
    ['Low', summary.LOW, 'var(--low)'],
    ['Info', summary.INFO, 'var(--info)']
  ];
  return (
    <>
      {items.map(([label, n, color]) =>
        n > 0 ? (
          <span className="chip" key={label}>
            <span className="dot" style={{ background: color }} />
            {label}
            <span className="count">{formatCount(n)}</span>
          </span>
        ) : null
      )}
      {items.every(([, n]) => n === 0) && (
        <span className="badge completed">No findings 🎉</span>
      )}
    </>
  );
}
