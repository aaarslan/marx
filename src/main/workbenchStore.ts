import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Finding, ResultsPage, ScanHistoryItem, ScanJobState } from '@shared/types';
import type { FindingQuery, FindingQueryPage, RemediationSession, WorkspaceState } from '@shared/workbench';
import { SEVERITY_ORDER } from '@shared/severity';

type PayloadRow = { payload: string };
type CountRow = { count: number };

function decode<T>(row: unknown): T | null {
  return row ? JSON.parse((row as PayloadRow).payload) as T : null;
}

function unresolvedJob(job: ScanJobState): boolean {
  return !job.finishedAt || ['Unknown', 'Queued', 'Running'].includes(job.status);
}

export class WorkbenchStore {
  private readonly db: DatabaseSync;

  constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try { fs.closeSync(fs.openSync(file, 'wx', 0o600)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
    this.db = new DatabaseSync(file);
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
      if (version > 1) throw new Error('This workbench was created by a newer version of Marx. Open it with that version; the database was left unchanged.');
      this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, finished_at INTEGER,
        updated_at INTEGER NOT NULL, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_connection ON jobs(connection_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS logs (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
        line TEXT NOT NULL, FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS logs_job ON logs(job_id, sequence);
      CREATE TABLE IF NOT EXISTS snapshots (
        connection_id TEXT NOT NULL, scan_id TEXT NOT NULL, imported_at INTEGER NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(connection_id, scan_id)
      );
      CREATE TABLE IF NOT EXISTS findings (
        connection_id TEXT NOT NULL, scan_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
        id TEXT NOT NULL, scanner TEXT NOT NULL, state TEXT NOT NULL, severity TEXT NOT NULL,
        severity_rank INTEGER NOT NULL, search_text TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(connection_id, scan_id, ordinal),
        FOREIGN KEY(connection_id, scan_id) REFERENCES snapshots(connection_id, scan_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS findings_filter ON findings(connection_id, scan_id, scanner, state, severity);
      CREATE INDEX IF NOT EXISTS findings_order ON findings(connection_id, scan_id, severity_rank DESC, ordinal);
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, updated_at INTEGER NOT NULL, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_connection ON sessions(connection_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS session_evidence (
        session_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('baseline','verification')),
        payload TEXT NOT NULL, PRIMARY KEY(session_id,kind),
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS workspaces (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      PRAGMA user_version = 1;
      COMMIT;
    `);
      this.protectFiles();
    } catch (error) {
      this.db.close();
      throw new Error(`The workbench database could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private protectFiles(): void {
    if (process.platform === 'win32') return;
    for (const file of [this.file, `${this.file}-wal`, `${this.file}-shm`]) {
      try { fs.chmodSync(file, 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    let value: T;
    try {
      value = operation();
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    this.protectFiles();
    return value;
  }

  saveJob(job: ScanJobState): void {
    if (!job.id || typeof job.id !== 'string') throw new Error('A durable scan job requires an identity.');
    this.db.prepare(`INSERT INTO jobs(id, connection_id, finished_at, updated_at, payload) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id, finished_at=excluded.finished_at,
      updated_at=excluded.updated_at, payload=excluded.payload`)
      .run(job.id, job.connectionId ?? '', job.finishedAt ?? null, Date.now(), JSON.stringify(job));
  }

  saveJobs(jobs: ScanJobState[]): void {
    this.transaction(() => { for (const job of jobs) this.saveJob(job); });
  }

  saveVerificationJob(job: ScanJobState, session: RemediationSession): void {
    if (session.verificationJobId !== job.id || session.connectionId !== job.connectionId || session.projectId !== job.projectId) throw new Error('The verification job must belong to its remediation session and project.');
    this.transaction(() => {
      this.saveJob(job);
      this.saveSession(session);
    });
  }

  jobs(connectionId?: string): ScanJobState[] {
    const rows = connectionId === undefined
      ? this.db.prepare('SELECT payload FROM jobs ORDER BY updated_at DESC').all()
      : this.db.prepare('SELECT payload FROM jobs WHERE connection_id=? ORDER BY updated_at DESC').all(connectionId);
    return rows.map((row) => decode<ScanJobState>(row)!);
  }

  appendLog(jobId: string, line: string): void {
    if (!this.db.prepare('SELECT id FROM jobs WHERE id=?').get(jobId)) return;
    this.transaction(() => {
      this.db.prepare('INSERT INTO logs(job_id,line) VALUES(?,?)').run(jobId, line.slice(0, 16_384));
      this.db.prepare('DELETE FROM logs WHERE job_id=? AND sequence NOT IN (SELECT sequence FROM logs WHERE job_id=? ORDER BY sequence DESC LIMIT 1000)').run(jobId, jobId);
    });
  }

  logs(jobId: string): string[] {
    return this.db.prepare('SELECT line FROM logs WHERE job_id=? ORDER BY sequence').all(jobId).map((row) => String(row.line));
  }

  saveSnapshot(connectionId: string, page: ResultsPage): ResultsPage {
    const scanId = page.scan?.id;
    if (!connectionId || !scanId) throw new Error('A scan and connection identity are required to save results.');
    if (!Number.isSafeInteger(page.totalCount) || page.totalCount < page.findings.length) throw new Error('Invalid findings count.');
    if (page.findings.some((finding) => finding.scanId !== scanId || finding.projectId !== page.scan?.projectId)) throw new Error('The findings do not belong to this scan and project.');
    const importedAt = Date.now();
    const saved = { ...page, connectionId, importedAt, cached: false };
    const { findings, ...metadata } = saved;
    this.transaction(() => {
      this.db.prepare(`INSERT INTO snapshots(connection_id,scan_id,imported_at,payload) VALUES(?,?,?,?)
        ON CONFLICT(connection_id,scan_id) DO UPDATE SET imported_at=excluded.imported_at,payload=excluded.payload`)
        .run(connectionId, scanId, importedAt, JSON.stringify(metadata));
      this.db.prepare('DELETE FROM findings WHERE connection_id=? AND scan_id=?').run(connectionId, scanId);
      const insert = this.db.prepare('INSERT INTO findings(connection_id,scan_id,ordinal,id,scanner,state,severity,severity_rank,search_text,payload) VALUES(?,?,?,?,?,?,?,?,?,?)');
      findings.forEach((finding, ordinal) => {
        const search = [finding.title, finding.where, finding.description, finding.cve, finding.cwe, finding.packageName,
          finding.packageVersion, finding.group, finding.similarityId, ...finding.flow.map((node) => node.fileName)].filter(Boolean).join('\n').toLowerCase();
        insert.run(connectionId, scanId, ordinal, finding.id, finding.type, finding.state, finding.severity,
          SEVERITY_ORDER[finding.severity] ?? SEVERITY_ORDER.UNKNOWN, search, JSON.stringify(finding));
      });
    });
    return saved;
  }

  snapshot(connectionId: string, scanId: string): ResultsPage | null {
    const metadata = decode<Omit<ResultsPage, 'findings'>>(this.db.prepare('SELECT payload FROM snapshots WHERE connection_id=? AND scan_id=?').get(connectionId, scanId));
    if (!metadata) return null;
    const findings = this.db.prepare('SELECT payload FROM findings WHERE connection_id=? AND scan_id=? ORDER BY ordinal').all(connectionId, scanId).map((row) => decode<Finding>(row)!);
    return { ...metadata, findings, cached: true };
  }

  hasSnapshot(connectionId: string, scanId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM snapshots WHERE connection_id=? AND scan_id=?').get(connectionId, scanId));
  }

  listSnapshots(connectionId: string): ScanHistoryItem[] {
    return this.db.prepare('SELECT payload FROM snapshots WHERE connection_id=? ORDER BY imported_at DESC').all(connectionId)
      .map((row) => decode<ResultsPage>(row)?.scan).filter((scan): scan is ScanHistoryItem => Boolean(scan));
  }

  queryFindings(connectionId: string, scanId: string, query: FindingQuery): FindingQueryPage {
    const metadata = decode<ResultsPage>(this.db.prepare('SELECT payload FROM snapshots WHERE connection_id=? AND scan_id=?').get(connectionId, scanId));
    if (!metadata) throw new Error('Import this scan before querying its findings.');
    const clauses = ['connection_id=?', 'scan_id=?'];
    const params: (string | number)[] = [connectionId, scanId];
    if (query.scanner && query.scanner !== 'ALL') { clauses.push('scanner=?'); params.push(query.scanner); }
    if (query.state && query.state !== 'ALL') { clauses.push('state=?'); params.push(query.state); }
    if (query.severities?.length) {
      clauses.push(`severity IN (${query.severities.map(() => '?').join(',')})`);
      params.push(...query.severities);
    }
    if (query.search?.trim()) {
      clauses.push('instr(search_text,?) > 0');
      params.push(query.search.trim().toLowerCase());
    }
    const where = clauses.join(' AND ');
    const filteredCount = Number((this.db.prepare(`SELECT count(*) AS count FROM findings WHERE ${where}`).get(...params) as CountRow).count);
    const limit = Math.max(1, Math.min(1000, Math.floor(Number.isFinite(query.limit) ? query.limit! : 200)));
    const offset = Math.max(0, Math.floor(Number.isFinite(query.offset) ? query.offset! : 0));
    const findings = this.db.prepare(`SELECT payload FROM findings WHERE ${where} ORDER BY severity_rank DESC, ordinal LIMIT ? OFFSET ?`).all(...params, limit, offset).map((row) => decode<Finding>(row)!);
    return { findings, filteredCount, totalCount: metadata.totalCount };
  }

  saveSession(session: RemediationSession): void {
    const existing = this.session(session.id);
    if (existing && (existing.connectionId !== session.connectionId || existing.baselineScanId !== session.baselineScanId || existing.projectId !== session.projectId)) throw new Error('A remediation session cannot change its connection, project, or baseline.');
    if (!session.id || !session.connectionId || !session.baselineScanId) throw new Error('A remediation session requires a connection and baseline.');
    this.db.prepare(`INSERT INTO sessions(id,connection_id,updated_at,payload) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,payload=excluded.payload`)
      .run(session.id, session.connectionId, session.updatedAt, JSON.stringify(session));
  }

  saveSessionWithEvidence(session: RemediationSession, kind: 'baseline' | 'verification', page: ResultsPage): void {
    this.transaction(() => {
      this.saveSession(session);
      this.saveSessionSnapshot(session.id, kind, page);
    });
  }

  session(id: string): RemediationSession | null {
    return decode<RemediationSession>(this.db.prepare('SELECT payload FROM sessions WHERE id=?').get(id));
  }

  sessions(connectionId: string): RemediationSession[] {
    return this.db.prepare('SELECT payload FROM sessions WHERE connection_id=? ORDER BY updated_at DESC').all(connectionId).map((row) => decode<RemediationSession>(row)!);
  }

  deleteSession(id: string): void {
    this.transaction(() => { this.db.prepare('DELETE FROM sessions WHERE id=?').run(id); });
  }

  saveSessionSnapshot(id: string, kind: 'baseline' | 'verification', page: ResultsPage): void {
    const session = this.session(id);
    if (!session) throw new Error('The remediation session was not found.');
    if (page.connectionId !== session.connectionId || page.scan?.projectId !== session.projectId) throw new Error('This evidence belongs to a different connection or project.');
    if (kind === 'baseline' && page.scan?.id !== session.baselineScanId) throw new Error('This evidence is not the session baseline.');
    if (kind === 'verification' && session.verification && page.scan?.id !== session.verification.scanId) throw new Error('This evidence does not match the session verification record.');
    if (kind === 'baseline') {
      this.db.prepare('INSERT INTO session_evidence(session_id,kind,payload) VALUES(?,?,?) ON CONFLICT(session_id,kind) DO NOTHING').run(id, kind, JSON.stringify(page));
    } else {
      this.db.prepare('INSERT INTO session_evidence(session_id,kind,payload) VALUES(?,?,?) ON CONFLICT(session_id,kind) DO UPDATE SET payload=excluded.payload').run(id, kind, JSON.stringify(page));
    }
  }

  sessionSnapshot(id: string, kind: 'baseline' | 'verification'): ResultsPage | null {
    return decode<ResultsPage>(this.db.prepare('SELECT payload FROM session_evidence WHERE session_id=? AND kind=?').get(id, kind));
  }

  workspace(key: string): WorkspaceState | null {
    return decode<WorkspaceState>(this.db.prepare('SELECT payload FROM workspaces WHERE key=?').get(key));
  }

  saveWorkspace(key: string, state: WorkspaceState): void {
    this.db.prepare('INSERT INTO workspaces(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload').run(key, JSON.stringify(state));
  }

  private referenced(connectionId: string, scanId: string): boolean {
    return this.sessions(connectionId).some((session) => session.baselineScanId === scanId || session.verification?.scanId === scanId)
      || this.jobs(connectionId).some((job) => job.scanId === scanId && unresolvedJob(job));
  }

  deleteSnapshot(connectionId: string, scanId: string): void {
    if (this.referenced(connectionId, scanId)) throw new Error('This scan is referenced by a remediation session or active job. Remove the session first.');
    this.db.prepare('DELETE FROM snapshots WHERE connection_id=? AND scan_id=?').run(connectionId, scanId);
  }

  prune(days: number): { snapshots: number; jobs: number } {
    if (!Number.isFinite(days) || days < 1) throw new Error('Choose a retention period of at least one day.');
    const cutoff = Date.now() - Math.min(36500, days) * 86_400_000;
    const old = this.db.prepare('SELECT connection_id,scan_id FROM snapshots WHERE imported_at<?').all(cutoff);
    const retainedJobIds = new Set(this.db.prepare('SELECT payload FROM sessions').all().map((row) => decode<RemediationSession>(row)?.verificationJobId).filter(Boolean));
    let snapshots = 0;
    let jobs = 0;
    this.transaction(() => {
      for (const row of old) {
        const connection = String(row.connection_id);
        const scan = String(row.scan_id);
        if (!this.referenced(connection, scan)) snapshots += Number(this.db.prepare('DELETE FROM snapshots WHERE connection_id=? AND scan_id=?').run(connection, scan).changes);
      }
      for (const row of this.db.prepare('SELECT id,payload FROM jobs WHERE finished_at IS NOT NULL AND finished_at<?').all(cutoff)) {
        if (!retainedJobIds.has(String(row.id)) && !unresolvedJob(decode<ScanJobState>(row)!)) jobs += Number(this.db.prepare('DELETE FROM jobs WHERE id=?').run(String(row.id)).changes);
      }
    });
    return { snapshots, jobs };
  }

  close(): void {
    this.db.close();
  }
}
