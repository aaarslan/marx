import { randomUUID } from 'node:crypto';
import type {
  ScanJobState,
  ScanOptions,
  ScanStatus
} from '@shared/types';
import type { CxCliClient } from './cxone/cli';
import type { CxScan } from './cxone/client';
import { CliBusyError } from './cliProcess';

export interface RunnerEvents {
  onJobUpdated: (job: ScanJobState) => void;
  onLog: (jobId: string, line: string) => void;
}

export interface RunJobInput {
  connectionId?: string;
  folderPath: string;
  projectName: string;
  projectId?: string;
  options: ScanOptions;
}

export class ScanRunner {
  private clients = new Map<string, CxCliClient>();
  private remoteCancelErrors = new Map<string, string>();
  private active = new Map<string, Promise<ScanJobState>>();
  private controllers = new Map<string, AbortController>();
  private canceled = new Set<string>();

  constructor(
    private readonly client: () => CxCliClient,
    private readonly events: RunnerEvents
  ) {}

  newJob(input: RunJobInput): ScanJobState {
    return {
      id: randomUUID(), folderPath: input.folderPath, projectName: input.projectName,
      connectionId: input.connectionId, projectId: input.projectId, branch: input.options.branch, options: input.options,
      progress: { phase: 'idle' }, status: 'Unknown', startedAt: Date.now()
    };
  }

  run(job: ScanJobState): Promise<ScanJobState> {
    const existing = this.active.get(job.id);
    if (existing) return existing;
    if (job.finishedAt) return Promise.resolve(job);
    if (this.active.size >= 8) {
      job.status = 'Failed';
      job.progress = { phase: 'failed' };
      job.error = 'Eight scans are already active. Wait for a scan to finish before starting another.';
      job.finishedAt = Date.now();
      this.events.onJobUpdated({ ...job });
      return Promise.resolve(job);
    }
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const task = this.execute(job, controller.signal).finally(() => {
      this.active.delete(job.id);
      this.controllers.delete(job.id);
      this.clients.delete(job.id);
      this.canceled.delete(job.id);
      this.remoteCancelErrors.delete(job.id);
    });
    this.active.set(job.id, task);
    return task;
  }

  private async execute(job: ScanJobState, signal: AbortSignal): Promise<ScanJobState> {
    const emit = (patch: Partial<ScanJobState>) => {
      Object.assign(job, patch);
      this.events.onJobUpdated({ ...job });
    };
    const log = (line: string) => this.events.onLog(job.id, `[${new Date().toLocaleTimeString()}] ${line}`);
    const checkCanceled = () => {
      if (signal.aborted || this.canceled.has(job.id)) throw new CancellationError();
    };
    let submitting = false;
    let remoteStatus: ScanStatus | undefined;
    try {
      checkCanceled();
      const client = this.client();
      this.clients.set(job.id, client);
      emit({ progress: { phase: 'submitting', detail: 'The official CLI is preparing and uploading source to Checkmarx One.' } });
      log('Starting the official Checkmarx CLI.');
      const scan = await client.createScan(job, signal, {
        onLine: log,
        onStarting: () => { submitting = true; },
        onSubmitted: (submitted) => {
          job.scanId = submitted.id;
          job.projectId = submitted.projectId;
          emit({});
        }
      });
      submitting = false;
      job.scanId = scan.id;
      job.projectId = scan.projectId;
      if (signal.aborted || this.canceled.has(job.id)) throw new CancellationError();
      emit({ scanId: scan.id, status: normalizeStatus(scan.status), progress: { phase: 'queued' } });
      const finalScan = await this.poll(job, client, signal, emit, log);
      checkCanceled();
      remoteStatus = normalizeStatus(finalScan.status);
      if (remoteStatus === 'Canceled') throw new CancellationError();
      if (remoteStatus === 'Failed') throw new Error(`Scan failed. ${finalScan.statusDetails?.details ?? ''}`.trim());
      emit({ status: normalizeStatus(finalScan.status), progress: { phase: 'fetching-results', detail: 'counting findings' } });
      let summary = null;
      let summaryError = false;
      try { summary = await client.getScanSummary(scan.id, signal); } catch (error) {
        checkCanceled();
        summaryError = true;
        log(`Summary unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
      checkCanceled();
      const counts = summaryToCounts(summary);
      emit({ progress: { phase: 'completed', detail: remoteStatus === 'Partial' ? 'Partial scan: some engines did not finish.' : !counts ? 'Scan finished. Summary unavailable; open results to inspect findings.' : undefined }, status: normalizeStatus(finalScan.status), summary: counts ?? undefined, finishedAt: Date.now() });
      if (!counts && !summaryError) log('Summary unavailable or unrecognized; open results to inspect findings.');
      log(`Done in ${fmtDuration(Date.now() - job.startedAt)}`);
    } catch (err) {
      const canceled = signal.aborted || this.canceled.has(job.id) || err instanceof CancellationError;
      if ((signal.aborted || this.canceled.has(job.id)) && job.scanId) await this.cancelRemote(job, this.clients.get(job.id)!);
      let message = canceled ? (this.remoteCancelErrors.get(job.id) ?? 'Scan canceled') : err instanceof Error ? err.message : String(err);
      if (job.scanId && !canceled && remoteStatus !== 'Failed') message += ' Local monitoring stopped; check the scan in Checkmarx One for its remote status.';
      if (submitting && !job.scanId) message += ' No scan ID was received. Remote submission is unconfirmed; check Checkmarx One before retrying.';
      emit({ progress: { phase: canceled ? 'canceled' : 'failed' }, status: canceled ? 'Canceled' : job.scanId && remoteStatus !== 'Failed' ? 'Unknown' : 'Failed', error: message, finishedAt: Date.now() });
      log(message);
    }
    return job;
  }

  private async poll(
    job: ScanJobState,
    client: CxCliClient,
    signal: AbortSignal,
    emit: (patch: Partial<ScanJobState>) => void,
    log: (line: string) => void
  ): Promise<CxScan> {
    const deadline = Date.now() + 24 * 60 * 60_000;
    let busyRetries = 0;
    let unknownStatuses = 0;
    for (;;) {
      signal.throwIfAborted();
      if (Date.now() >= deadline) throw new Error('Scan polling timed out after 24 hours. Check the scan in Checkmarx One.');
      let delay = 5000;
      try {
        const scan = await client.getScan(job.scanId!, signal);
        signal.throwIfAborted();
        const status = normalizeStatus(scan.status);
        if (['Completed', 'Partial', 'Failed', 'Canceled'].includes(status)) return scan;
        if (status === 'Unknown') {
          if (++unknownStatuses >= 3) throw new Error(`The CLI repeatedly reported an unrecognized scan status: ${scan.status}`);
          emit({ status, progress: { phase: 'running', detail: `CLI status: ${scan.status}; waiting for an update` } });
        } else {
          unknownStatuses = 0;
          emit({ status, progress: status === 'Queued'
            ? { phase: 'queued', detail: 'Queued in Checkmarx One' }
            : { phase: 'running', detail: 'Scanning in Checkmarx One' } });
        }
        busyRetries = 0;
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof CliBusyError) || ++busyRetries > 5) throw error;
        log('CLI capacity is temporarily full; retrying scan monitoring.');
        delay = Math.min(10_000, 1000 * 2 ** (busyRetries - 1)) * (0.75 + Math.random() * 0.5);
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new CancellationError()); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }

  private async cancelRemote(job: ScanJobState, client: CxCliClient): Promise<void> {
    try { await client.cancelScan(job.scanId!); } catch (err) {
      const message = `Local monitoring stopped; remote cancellation is unconfirmed: ${err instanceof Error ? err.message : String(err)}`;
      this.remoteCancelErrors.set(job.id, message);
      this.events.onLog(job.id, message);
      if (job.finishedAt) { job.error = message; this.events.onJobUpdated({ ...job }); this.remoteCancelErrors.delete(job.id); }
    }
  }

  async cancelJob(job: ScanJobState): Promise<void> {
    if (job.finishedAt) return;
    this.canceled.add(job.id);
    this.controllers.get(job.id)?.abort();
    if (!this.active.has(job.id)) {
      job.progress = { phase: 'canceled' };
      job.status = 'Canceled';
      job.finishedAt = Date.now();
      this.canceled.delete(job.id);
      this.events.onJobUpdated({ ...job });
    }
  }
}

export class CancellationError extends Error {
  constructor() {
    super('Scan canceled');
    this.name = 'CancellationError';
  }
}

function normalizeStatus(raw: unknown): ScanStatus {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'new') return 'Queued';
  return (['Queued', 'Running', 'Completed', 'Failed', 'Canceled', 'Partial'] as const)
    .find((status) => status.toLowerCase() === value) ?? 'Unknown';
}

export function summaryToCounts(summary: unknown): ScanJobState['summary'] | null {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  const src = (summary ?? {}) as Record<string, unknown>;
  const scanObj = Array.isArray(src.scans) ? (src.scans[0] as Record<string, unknown> | undefined) : undefined;
  if (!['critical', 'high', 'medium', 'low', 'info'].every((key) => {
    const value = scanObj?.[key] ?? src[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  })) return null;
  const pick = (key: string): number => {
    const v = scanObj?.[key] ?? src[key];
    return typeof v === 'number' ? v : Number(v ?? 0) || 0;
  };
  counts.CRITICAL = pick('critical');
  counts.HIGH = pick('high');
  counts.MEDIUM = pick('medium');
  counts.LOW = pick('low');
  counts.INFO = pick('info');
  return counts;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
