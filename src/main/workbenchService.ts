import { randomUUID } from 'node:crypto';
import type { ResultsPage, ScanHistoryItem, ScanJobState } from '@shared/types';
import type { EvidenceBundle, RemediationSession, WorkspaceState } from '@shared/workbench';
import { compareScans, verifySelectedFindings } from '@shared/comparison';
import { severityRank } from '@shared/severity';
import { normalizeFindings } from './cxone/normalize';
import type { CxCliClient } from './cxone/cli';
import type { WorkbenchStore } from './workbenchStore';

interface ImportTask {
  controller: AbortController;
  readers: Set<string>;
  promise: Promise<ResultsPage>;
}

const boundedText = (value: unknown, name: string, max: number): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be text under ${max.toLocaleString()} characters.`);
  return value;
};

export class WorkbenchService {
  private imports = new Map<string, ImportTask>();
  private requests = new Map<string, ImportTask>();
  private pendingRequests = new Map<string, Set<AbortController>>();

  constructor(readonly store: WorkbenchStore, private readonly client: () => CxCliClient) {}

  async connection(): Promise<string> {
    const id = await this.client().connectionId();
    this.store.saveWorkspace('_connection', { connectionId: id });
    return id;
  }

  async localConnection(): Promise<string> {
    try { return await this.connection(); } catch {
      const id = this.store.workspace('_connection')?.connectionId;
      if (!id) throw new Error('Connect the Checkmarx CLI to create your first workspace.');
      return id;
    }
  }

  async workspace(key: string): Promise<WorkspaceState | null> {
    const connection = await this.localConnection().catch(() => 'local');
    return this.store.workspace(`${connection}:${boundedText(key, 'Workspace key', 512)}`);
  }

  async saveWorkspace(key: string, state: WorkspaceState): Promise<void> {
    if (!state || typeof state !== 'object' || JSON.stringify(state).length > 32_768) throw new Error('Workspace state is invalid or too large.');
    const connection = await this.localConnection().catch(() => 'local');
    this.store.saveWorkspace(`${connection}:${boundedText(key, 'Workspace key', 512)}`, state);
  }

  async results(scanId: string, options: { refresh?: boolean; requestId?: string } = {}): Promise<ResultsPage> {
    boundedText(scanId, 'Scan ID', 256);
    const requestId = options.requestId ?? randomUUID();
    boundedText(requestId, 'Request ID', 256);
    const waiting = new AbortController();
    const pending = this.pendingRequests.get(requestId) ?? new Set<AbortController>();
    pending.add(waiting);
    this.pendingRequests.set(requestId, pending);
    let task: ImportTask | undefined;
    try {
      const connection = await this.localConnection();
      waiting.signal.throwIfAborted();
      const cached = this.store.snapshot(connection, scanId);
      if (cached && !options.refresh) return cached;
      const selected = this.client();
      if (await selected.connectionId() !== connection) throw new Error('Connection changed. Reload the workspace.');
      waiting.signal.throwIfAborted();
      const key = `${connection}:${scanId}`;
      task = this.imports.get(key);
      if (!task || task.controller.signal.aborted) {
        const controller = new AbortController();
        const newTask: ImportTask = { controller, readers: new Set(), promise: Promise.resolve(null as unknown as ResultsPage) };
        newTask.promise = this.importResults(selected, connection, scanId, controller.signal).finally(() => {
          if (this.imports.get(key) === newTask) this.imports.delete(key);
        });
        this.imports.set(key, newTask);
        task = newTask;
      }
      if (this.requests.get(requestId) !== task) this.cancelImport(requestId);
      task.readers.add(requestId);
      this.requests.set(requestId, task);
      return await task.promise;
    } finally {
      pending.delete(waiting);
      if (!pending.size && this.pendingRequests.get(requestId) === pending) this.pendingRequests.delete(requestId);
      if (task) {
        task.readers.delete(requestId);
        if (this.requests.get(requestId) === task) this.requests.delete(requestId);
      }
    }
  }

  cancel(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) for (const waiting of pending) waiting.abort();
    this.pendingRequests.delete(requestId);
    this.cancelImport(requestId);
  }

  private cancelImport(requestId: string): void {
    const task = this.requests.get(requestId);
    if (!task) return;
    this.requests.delete(requestId);
    task.readers.delete(requestId);
    if (!task.readers.size) task.controller.abort();
  }

  private async importResults(selected: CxCliClient, connection: string, scanId: string, signal: AbortSignal): Promise<ResultsPage> {
    const scan = await selected.getScan(scanId, signal);
    const raw = await selected.getAllResults(scanId, undefined, signal);
    signal.throwIfAborted();
    if (selected !== this.client() || await selected.connectionId() !== connection) throw new Error('Connection changed during import. Reload this scan.');
    const findings = normalizeFindings(raw.results, scanId, scan.projectId ?? '').map((item) => ({ ...item, connectionId: connection }));
    findings.sort((a, b) => severityRank(a.severity, b.severity));
    const job = this.store.jobs(connection).find((item) => item.scanId === scanId);
    const provenance = job?.provenance ? structuredClone(job.provenance) : undefined;
    if (provenance) {
      if (scan.completedEngines?.length) provenance.completedScanners = scan.completedEngines;
      if (scan.effectiveConfigFingerprint) provenance.effectiveConfigFingerprint = scan.effectiveConfigFingerprint;
    }
    const history: ScanHistoryItem = {
      id: scan.id, projectId: scan.projectId ?? '', projectName: scan.projectName ?? '', branch: scan.branch ?? '',
      status: ['Completed', 'Partial', 'Canceled', 'Failed', 'Queued', 'Running'].includes(scan.status) ? scan.status as ScanHistoryItem['status'] : 'Unknown',
      createdAt: scan.createdAt ?? '', updatedAt: scan.updatedAt ?? '', sourceOrigin: scan.sourceOrigin, tags: scan.tags, provenance
    };
    const page: ResultsPage = {
      findings, totalCount: raw.totalCount, truncated: raw.truncated, scan: history, provenance, connectionId: connection,
      importedAt: Date.now(), cached: false,
      counts: { reported: raw.totalCount, received: raw.results.length, normalized: findings.length, unsupported: findings.filter((f) => !['sast', 'sca', 'kics', 'iac-security', 'secrets'].includes(f.type)).length }
    };
    signal.throwIfAborted();
    return this.store.saveSnapshot(connection, page);
  }

  async session(id: string): Promise<RemediationSession> {
    const connection = await this.localConnection();
    const item = this.store.session(boundedText(id, 'Session ID', 128));
    if (!item || item.connectionId !== connection) throw new Error('This remediation session is not available in the current connection.');
    return item;
  }

  async createSession(input: { title: string; scanId: string; findingIds: string[]; folderPath?: string; handoff?: string }): Promise<RemediationSession> {
    const title = boundedText(input.title, 'Title', 200).trim();
    if (!title) throw new Error('Give the remediation session a title.');
    const page = await this.results(input.scanId);
    if (!page.scan?.projectId || !page.connectionId) throw new Error('Select an imported Checkmarx scan first.');
    if (!Array.isArray(input.findingIds) || !input.findingIds.length || input.findingIds.length > 100_000) throw new Error('Select findings for this session.');
    const ids = [...new Set(input.findingIds)];
    const known = new Set(page.findings.map((finding) => finding.id));
    if (ids.some((id) => typeof id !== 'string' || !known.has(id))) throw new Error('The selection contains findings outside the baseline scan.');
    const folderPath = input.folderPath ?? page.provenance?.source.folderPath;
    if (input.folderPath && page.provenance?.source.folderPath && input.folderPath !== page.provenance.source.folderPath) throw new Error('The selected folder differs from the scan provenance.');
    const session: RemediationSession = {
      id: randomUUID(), connectionId: page.connectionId, title, baselineScanId: input.scanId,
      projectId: page.scan.projectId, projectName: page.scan.projectName, folderPath, findingIds: ids,
      status: 'open', createdAt: Date.now(), updatedAt: Date.now(), notes: '', changeRef: '', checks: '',
      handoff: input.handoff === undefined ? undefined : boundedText(input.handoff, 'Handoff', 8 * 1024 * 1024)
    };
    this.store.saveSessionWithEvidence(session, 'baseline', page);
    return session;
  }

  async updateSession(input: { id: string; title?: string; notes?: string; changeRef?: string; checks?: string; status?: string; handoff?: string }): Promise<RemediationSession> {
    const session = await this.session(input.id);
    const next = { ...session, updatedAt: Date.now() };
    for (const field of ['title', 'notes', 'changeRef', 'checks', 'handoff'] as const) {
      if (input[field] !== undefined) next[field] = boundedText(input[field], field, field === 'title' ? 200 : field === 'handoff' ? 8 * 1024 * 1024 : 32_768);
    }
    if (!next.title.trim()) throw new Error('Give the session a title.');
    if (input.status !== undefined) {
      if (!['open', 'in_progress', 'awaiting_verification'].includes(input.status)) throw new Error('Only a scan comparison can establish verification status.');
      next.status = input.status as RemediationSession['status'];
    }
    this.store.saveSession(next);
    return next;
  }

  async verify(id: string, scanId: string): Promise<RemediationSession> {
    const session = await this.session(id);
    if (scanId === session.baselineScanId) throw new Error('Choose a later scan to verify this remediation.');
    const baseline = this.store.sessionSnapshot(id, 'baseline');
    if (!baseline) throw new Error('The original evidence for this session is unavailable.');
    const current = await this.results(scanId, { refresh: true });
    if (current.scan?.projectId !== session.projectId || current.connectionId !== session.connectionId) throw new Error('The verification scan belongs to another project or connection.');
    if (current.scan?.status !== 'Completed') throw new Error('Wait for a completed verification scan.');
    const baseDate = Date.parse(baseline.scan?.createdAt ?? '');
    const currentDate = Date.parse(current.scan.createdAt);
    if (!Number.isFinite(baseDate) || !Number.isFinite(currentDate) || currentDate <= baseDate) throw new Error('Verification requires a completed scan later than the baseline.');
    const comparison = compareScans(baseline, current);
    const { absentIds, remainingIds } = verifySelectedFindings(baseline, current, session.findingIds, comparison);
    const newIds = current.findings.filter((finding) => comparison.changes[finding.id] === 'NEW').map((finding) => finding.id);
    const latest = await this.session(id);
    const next: RemediationSession = {
      ...latest, updatedAt: Date.now(), status: comparison.compatibility === 'comparable' && comparison.verdict === 'pass' && !remainingIds.length ? 'verified' : 'unresolved',
      verification: { scanId, checkedAt: Date.now(), comparison, remainingIds, absentIds, newIds }
    };
    this.store.saveSessionWithEvidence(next, 'verification', current);
    return next;
  }

  async bundle(id: string): Promise<EvidenceBundle> {
    const session = await this.session(id);
    const baseline = this.store.sessionSnapshot(id, 'baseline');
    if (!baseline) throw new Error('Original session evidence is unavailable.');
    return { format: 'marx-remediation', version: 1, exportedAt: new Date().toISOString(), session, baseline, verification: this.store.sessionSnapshot(id, 'verification') ?? undefined };
  }

  async bootstrap() {
    const connectionId = await this.localConnection().catch(() => null);
    if (!connectionId) return { connectionId, jobs: [], sessions: [], scans: [], logs: {} };
    const jobs = this.store.jobs(connectionId);
    return { connectionId, jobs, sessions: this.store.sessions(connectionId), scans: this.store.listSnapshots(connectionId), logs: Object.fromEntries(jobs.map((job) => [job.id, this.store.logs(job.id)])) };
  }

  async requireJob(id: string): Promise<ScanJobState> {
    const connection = await this.connection();
    const job = this.store.jobs(connection).find((item) => item.id === id);
    if (!job) throw new Error('The job is unavailable in the current connection.');
    return job;
  }
}
