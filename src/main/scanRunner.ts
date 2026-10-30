import { randomUUID } from 'node:crypto';
import type {
  ScanJobState,
  ScanOptions,
  ScanStatus
} from '@shared/types';
import { DEFAULT_EXCLUDES } from '@shared/types';
import { CxOneApiError } from './cxone/client';
import type { CxOneClient } from './cxone/client';
import type { CxScan } from './cxone/client';
import type { zipFolder } from './zipSource';

export interface RunnerEvents {
  onJobUpdated: (job: ScanJobState) => void;
  onLog: (jobId: string, line: string) => void;
}

export interface RunJobInput {
  folderPath: string;
  projectName: string;
  /** reuse an existing platform project id (skip lookup/creation) */
  projectId?: string;
  options: ScanOptions;
}

export class ScanRunner {
  private clients = new Map<string, CxOneClient>();
  private remoteCancelErrors = new Map<string, string>();
  private active = new Map<string, Promise<ScanJobState>>();
  private controllers = new Map<string, AbortController>();
  private canceled = new Set<string>();

  constructor(
    private readonly client: () => CxOneClient,
    private readonly events: RunnerEvents
  ) {}

  newJob(input: RunJobInput): ScanJobState {
    return {
      id: randomUUID(), folderPath: input.folderPath, projectName: input.projectName,
      projectId: input.projectId, branch: input.options.branch, options: input.options,
      progress: { phase: 'idle' }, status: 'Unknown', startedAt: Date.now()
    };
  }

  run(job: ScanJobState): Promise<ScanJobState> {
    const existing = this.active.get(job.id);
    if (existing) return existing;
    if (job.finishedAt) return Promise.resolve(job);
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
    let zip: Awaited<ReturnType<typeof zipFolder>> | undefined;
    try {
      checkCanceled();
      const client = this.client();
      this.clients.set(job.id, client);
      emit({ progress: { phase: 'resolving-project', detail: `project "${job.projectName}"` } });
      if (!job.projectId) {
        job.projectId = await findOrCreateProject(client, job.projectName, job.branch, signal);
        emit({});
      }
      checkCanceled();
      const excludes = buildExcludes(job.options);
      const { zipFolder } = await import('./zipSource');
      checkCanceled();
      emit({ progress: { phase: 'zipping', detail: excludes.join(', ') } });
      log(`Zipping ${job.folderPath}`);
      let lastProgress = 0;
      zip = await zipFolder({
        folder: job.folderPath, excludes, signal,
        onProgress: (bytes, files) => {
          if (Date.now() - lastProgress < 100) return;
          lastProgress = Date.now();
          emit({ progress: { phase: 'zipping', detail: `${files} files, ${fmtBytes(bytes)}` } });
        }
      });
      log(`Zip ready: ${fmtBytes(zip.bytes)}, ${zip.fileCount} files`);
      checkCanceled();
      emit({ progress: { phase: 'uploading', detail: fmtBytes(zip.bytes), percent: 0 } });
      const uploadUrl = await client.createUploadUrl(signal);
      checkCanceled();
      await client.uploadZip(uploadUrl, zip, (sent) => {
        if (signal.aborted) return;
        emit({ progress: { phase: 'uploading', detail: `${fmtBytes(sent)} / ${fmtBytes(zip!.bytes)} sent`, percent: Math.round(sent / Math.max(zip!.bytes, 1) * 100) } });
      }, signal);
      await zip.cleanup();
      zip = undefined;
      checkCanceled();
      emit({ progress: { phase: 'queued', detail: 'submitting scan' } });
      const scan = await client.createScan(buildScanRequest(job, uploadUrl));
      job.scanId = scan.id;
      if (signal.aborted || this.canceled.has(job.id)) {
        await this.cancelRemote(job, client);
        throw new CancellationError();
      }
      emit({ scanId: scan.id, status: normalizeStatus(scan.status), progress: { phase: 'queued' } });
      const finalScan = await this.poll(job, client, signal, emit, log);
      checkCanceled();
      if (finalScan.status === 'Canceled') throw new CancellationError();
      if (finalScan.status === 'Failed') throw new Error(`Scan failed. ${finalScan.statusDetails?.details ?? ''}`.trim());
      emit({ status: normalizeStatus(finalScan.status), progress: { phase: 'fetching-results', detail: 'counting findings' } });
      const summary = await client.getScanSummary(scan.id, signal);
      checkCanceled();
      const counts = summaryToCounts(summary);
      emit({ progress: { phase: 'completed', detail: finalScan.status === 'Partial' ? 'Partial scan: some engines did not finish.' : undefined }, status: normalizeStatus(finalScan.status), summary: counts ?? undefined, finishedAt: Date.now() });
      if (!counts) log('Summary unavailable or unrecognized; open results to inspect findings.');
      log(`Done in ${fmtDuration(Date.now() - job.startedAt)}`);
    } catch (err) {
      const canceled = signal.aborted || this.canceled.has(job.id) || err instanceof CancellationError;
      const message = canceled ? (this.remoteCancelErrors.get(job.id) ?? 'Scan canceled') : err instanceof Error ? err.message : String(err);
      emit({ progress: { phase: canceled ? 'canceled' : 'failed' }, status: canceled ? 'Canceled' : 'Failed', error: message, finishedAt: Date.now() });
      log(message);
    } finally {
      await zip?.cleanup().catch((err) => log(`Could not remove temporary zip: ${String(err)}`));
    }
    return job;
  }

  private async poll(
    job: ScanJobState,
    client: CxOneClient,
    signal: AbortSignal,
    emit: (patch: Partial<ScanJobState>) => void,
    log: (line: string) => void
  ): Promise<CxScan> {
    let retries = 0;
    const deadline = Date.now() + 24 * 60 * 60_000;
    for (;;) {
      signal.throwIfAborted();
      if (Date.now() >= deadline) throw new Error('Scan polling timed out after 24 hours. Check the scan in Checkmarx One.');
      let delay = 5000;
      try {
        const scan = await client.getScan(job.scanId!, signal);
        signal.throwIfAborted();
        const status = normalizeStatus(scan.status);
        if (['Completed', 'Partial', 'Failed', 'Canceled'].includes(status)) return scan;
        if (status !== 'Queued' && status !== 'Running') throw new CxOneApiError(`Unknown scan status: ${scan.status}`);
        retries = 0;
        emit({ status, progress: status === 'Queued'
          ? { phase: 'queued', queuePosition: scan.positionInQueue, detail: scan.positionInQueue === undefined ? undefined : `position ${scan.positionInQueue}` }
          : { phase: 'running', detail: scan.statusDetails?.name ?? scan.statusDetails?.status } });
      } catch (err) {
        signal.throwIfAborted();
        const transient = err instanceof TypeError || (err instanceof Error && err.name === 'TimeoutError') ||
          (err instanceof CxOneApiError && (err.status === 408 || err.status === 429 || (err.status ?? 0) >= 500));
        if (!transient || ++retries > 6) throw err;
        log(`poll error: ${err instanceof Error ? err.message : String(err)}`);
        delay = Math.min(60_000, 2000 * 2 ** (retries - 1)) * (0.75 + Math.random() * 0.5);
        if (err instanceof CxOneApiError && err.retryAfterMs !== undefined) {
          if (err.retryAfterMs > 300_000) throw err;
          delay = Math.max(delay, err.retryAfterMs);
        }
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new CancellationError()); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }

  private async cancelRemote(job: ScanJobState, client: CxOneClient): Promise<void> {
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
    if (job.scanId) await this.cancelRemote(job, this.clients.get(job.id) ?? this.client());
  }
}

export class CancellationError extends Error {
  constructor() {
    super('Scan canceled');
    this.name = 'CancellationError';
  }
}

function buildExcludes(options: ScanOptions): string[] {
  const set = new Set(DEFAULT_EXCLUDES);
  for (const e of options.excludes) {
    const t = e.trim();
    if (t.startsWith('!')) set.delete(t.slice(1));
    else if (t) set.add(t);
  }
  return [...set];
}

export function buildScanRequest(job: ScanJobState, uploadUrl: string) {
  const config: { type: string; value: Record<string, unknown> }[] = [];
  if (job.options.scanners.includes('sast')) {
    const value: Record<string, unknown> = {};
    if (job.options.sastPreset) value.presetName = job.options.sastPreset;
    if (job.options.sastIncremental) {
      value.incremental = 'true';
      if (job.options.sastBaseBranch) value.baseBranch = job.options.sastBaseBranch;
    } else {
      value.incremental = 'false';
    }
    config.push({ type: 'sast', value });
  }
  if (job.options.scanners.includes('sca')) {
    const value: Record<string, unknown> = {};
    if (job.options.scaExploitablePath) value.ExploitablePath = 'true';
    config.push({ type: 'sca', value });
  }
  return {
    type: 'upload' as const,
    handler: { branch: job.branch, uploadUrl },
    project: { id: job.projectId! },
    config,
    ...(Object.keys(job.options.tags).length ? { tags: job.options.tags } : {})
  };
}

async function findOrCreateProject(
  client: CxOneClient,
  name: string,
  branch: string,
  signal?: AbortSignal
): Promise<string> {
  const { projects, truncated } = await client.listProjects(1000, signal);
  signal?.throwIfAborted();
  const existing = projects.find(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) return existing.id;
  if (truncated !== false) {
    throw new Error('The project list is incomplete. Automatic creation was blocked to avoid a duplicate project. Choose an existing project in Scan options.');
  }
  const created = await client.createProject(name, branch);
  return created.id;
}

function normalizeStatus(raw: unknown): ScanStatus {
  const s = String(raw ?? '');
  return (['Queued', 'Running', 'Completed', 'Failed', 'Canceled', 'Partial'] as const).includes(
    s as never
  )
    ? (s as ScanStatus)
    : 'Unknown';
}

export function summaryToCounts(summary: unknown): ScanJobState['summary'] | null {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  const src = (summary ?? {}) as Record<string, unknown>;
  // scan-summary returns either flat counters or per-scan objects
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
