import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WorkbenchService } from '../src/main/workbenchService';
import { WorkbenchStore } from '../src/main/workbenchStore';
import type { CxCliClient } from '../src/main/cxone/cli';
import type { CxResult, CxScan } from '../src/main/cxone/types';
import type { ScanJobState, ScannerType } from '../src/shared/types';
import type { ScanProvenance } from '../src/shared/workbench';

type Report = { results: CxResult[]; totalCount: number; truncated: boolean };
const folders: string[] = [];
const stores = new Set<WorkbenchStore>();

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores) store.close();
  stores.clear();
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

class FakeCxClient {
  connection = 'tenant-a';
  online = true;
  scans = new Map<string, CxScan>();
  reports = new Map<string, Report>();
  connectionId = vi.fn(async () => {
    if (!this.online) throw new Error('CLI unavailable');
    return this.connection;
  });
  getScan = vi.fn(async (id: string, _signal?: AbortSignal): Promise<CxScan> => {
    const scan = this.scans.get(id);
    if (!scan) throw new Error('Unknown scan');
    return structuredClone(scan);
  });
  getAllResults = vi.fn(async (id: string, _max?: number, _signal?: AbortSignal): Promise<Report> => {
    const report = this.reports.get(id);
    if (!report) throw new Error('Unknown report');
    return structuredClone(report);
  });
  add(id: string, results: CxResult[], options: { incomplete?: boolean; scanners?: ScannerType[]; qualified?: boolean } = {}) {
    this.scans.set(id, {
      id, projectId: 'project', projectName: 'Project', branch: 'main', status: 'Completed',
      createdAt: id === 'before' ? '2026-01-01T00:00:00Z' : '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
      completedEngines: options.qualified ? options.scanners ?? ['sast'] : undefined,
      effectiveConfigFingerprint: options.qualified ? 'server-config' : undefined
    });
    this.reports.set(id, { results, totalCount: results.length + (options.incomplete ? 1 : 0), truncated: Boolean(options.incomplete) });
  }
}

function raw(id = 'finding', extra: Partial<CxResult> = {}): CxResult {
  return { id, type: 'sast', similarityId: id, severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW', data: { queryName: 'SQL Injection', nodes: [{ fileName: '/src/app.ts', line: 1 }] }, ...extra };
}

function open() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-service-'));
  folders.push(folder);
  const file = path.join(folder, 'workbench.sqlite');
  const store = new WorkbenchStore(file);
  stores.add(store);
  const client = new FakeCxClient();
  const service = new WorkbenchService(store, () => client as unknown as CxCliClient);
  return { file, store, client, service };
}

function qualifiedJob(store: WorkbenchStore, scanId: string, scanners: ScannerType[] = ['sast']) {
  const options = { scanners, branch: 'main', sastPreset: 'Default', sastIncremental: false, scaExploitablePath: false, excludes: ['node_modules'], tags: {} };
  const provenance: ScanProvenance = {
    version: 1, connectionId: 'tenant-a', capturedAt: 1,
    source: { folderPath: '/repo', repositoryRoot: '/repo', branch: 'main', dirty: false, fingerprint: `source-${scanId}`, capturedAt: 1, snapshot: true },
    options, optionsFingerprint: 'requested-options', requestedScanners: scanners
  };
  const job: ScanJobState = {
    id: `job-${scanId}`, connectionId: 'tenant-a', scanId, projectId: 'project', projectName: 'Project',
    folderPath: '/repo', branch: 'main', options, provenance, status: 'Completed', progress: { phase: 'completed' }, startedAt: 1, finishedAt: 2
  };
  store.saveJob(job);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('workbench service integration', () => {
  it('pins session evidence across live triage refresh, cache replacement and restart', async () => {
    const { file, store, client, service } = open();
    client.add('before', [raw()]);
    const original = await service.results('before');
    const session = await service.createSession({ title: 'Fix injection', scanId: 'before', findingIds: [original.findings[0].id], handoff: 'Original handoff' });
    client.add('before', [raw('finding', { state: 'NOT_EXPLOITABLE' })]);
    const refreshed = await service.results('before', { refresh: true });
    expect(refreshed.findings[0].state).toBe('NOT_EXPLOITABLE');
    expect((await service.bundle(session.id)).baseline.findings[0].state).toBe('TO_VERIFY');
    store.close();
    stores.delete(store);
    const reopened = new WorkbenchStore(file);
    stores.add(reopened);
    const resumed = new WorkbenchService(reopened, () => client as unknown as CxCliClient);
    client.online = false;
    expect((await resumed.results('before')).findings[0].state).toBe('NOT_EXPLOITABLE');
    const bundle = await resumed.bundle(session.id);
    expect(bundle.baseline.findings[0].state).toBe('TO_VERIFY');
    expect(bundle.session.handoff).toBe('Original handoff');
    expect(bundle.session.findingIds).toEqual(['finding']);
  });

  it('isolates cached scans, workspace selections and sessions by connection', async () => {
    const { client, service } = open();
    client.add('before', [raw('tenant-a-finding')]);
    await service.results('before');
    await service.saveWorkspace('results', { selectedScanId: 'before', search: 'tenant-a' });
    const session = await service.createSession({ title: 'Tenant A', scanId: 'before', findingIds: ['tenant-a-finding'] });
    client.connection = 'tenant-b';
    client.add('before', [raw('tenant-b-finding')]);
    expect((await service.results('before')).findings[0].id).toBe('tenant-b-finding');
    expect(await service.workspace('results')).toBeNull();
    await expect(service.session(session.id)).rejects.toThrow('current connection');
    await expect(service.updateSession({ id: session.id, notes: 'Wrong tenant' })).rejects.toThrow('current connection');
    client.connection = 'tenant-a';
    expect((await service.results('before')).findings[0].id).toBe('tenant-a-finding');
    expect((await service.workspace('results'))?.search).toBe('tenant-a');
    expect((await service.session(session.id)).notes).toBe('');
  });

  it('imports more than 5000 findings without collapsing duplicate vendor IDs', async () => {
    const { store, client, service } = open();
    const findings = Array.from({ length: 6001 }, (_, index) => raw(`finding-${index}`));
    findings.push(...['first-package', 'second-package'].map((name) => raw('CVE-2026-1234', {
      type: 'sca', vulnerabilityDetails: { cveName: 'CVE-2026-1234' },
      data: { packageIdentifier: { name, version: '1.0.0', packageManager: 'npm' } }
    })));
    client.add('before', findings);
    const page = await service.results('before');
    expect(page.findings).toHaveLength(6003);
    expect(page.truncated).toBe(false);
    expect(new Set(page.findings.map((finding) => finding.id)).size).toBe(6003);
    const duplicates = page.findings.filter((finding) => finding.vendorId === 'CVE-2026-1234');
    expect(duplicates).toHaveLength(2);
    const session = await service.createSession({ title: 'One dependency', scanId: 'before', findingIds: [duplicates[0].id] });
    expect(session.findingIds).toHaveLength(1);
    expect(store.queryFindings('tenant-a', 'before', { search: 'second-package' }).findings).toHaveLength(1);
    expect(store.queryFindings('tenant-a', 'before', { offset: 6000 }).findings).toHaveLength(3);
  });

  it('shares an import across readers and preserves it when one reader cancels', async () => {
    const { client, service } = open();
    client.add('before', [raw()]);
    const pending = deferred<Report>();
    let signal: AbortSignal | undefined;
    client.getAllResults.mockImplementationOnce(async (_id, _max, inputSignal) => { signal = inputSignal; return pending.promise; });
    const first = service.results('before', { requestId: 'first' });
    const second = service.results('before', { requestId: 'second' });
    await vi.waitFor(() => expect(client.getAllResults).toHaveBeenCalledTimes(1));
    service.cancel('first');
    expect(signal?.aborted).toBe(false);
    pending.resolve(client.reports.get('before')!);
    const pages = await Promise.all([first, second]);
    expect(pages.every((page) => page.findings.length === 1)).toBe(true);
    expect(client.getScan).toHaveBeenCalledTimes(1);
  });

  it('aborts the final reader without persisting a late response', async () => {
    const { store, client, service } = open();
    client.add('before', [raw()]);
    const pending = deferred<Report>();
    let signal: AbortSignal | undefined;
    client.getAllResults.mockImplementationOnce(async (_id, _max, inputSignal) => { signal = inputSignal; return pending.promise; });
    const request = service.results('before', { requestId: 'only' });
    const observed = request.catch((error) => error as Error);
    await vi.waitFor(() => expect(client.getAllResults).toHaveBeenCalledTimes(1));
    service.cancel('only');
    expect(signal?.aborted).toBe(true);
    pending.resolve(client.reports.get('before')!);
    expect(await observed).toMatchObject({ name: 'AbortError' });
    expect(store.snapshot('tenant-a', 'before')).toBeNull();
  });

  it('does not cancel a fresh consumer when its request ID replaces the same in-flight scan', async () => {
    const { client, service } = open();
    client.add('before', [raw()]);
    const pending = deferred<Report>();
    let signal: AbortSignal | undefined;
    client.getAllResults.mockImplementationOnce(async (_id, _max, inputSignal) => { signal = inputSignal; return pending.promise; });
    const first = service.results('before', { requestId: 'reused' });
    const firstResult = first.catch((error) => error as Error);
    await vi.waitFor(() => expect(client.getAllResults).toHaveBeenCalledTimes(1));
    const second = service.results('before', { requestId: 'reused' });
    const secondResult = second.catch((error) => error as Error);
    await vi.waitFor(() => expect(client.connectionId.mock.calls.length).toBeGreaterThanOrEqual(4));
    pending.resolve(client.reports.get('before')!);
    const observed = await secondResult;
    expect(observed).toHaveProperty('findings');
    await firstResult;
    expect(signal?.aborted).toBe(false);
  });

  it('honors cancellation while connection discovery is still pending', async () => {
    const { store, client, service } = open();
    client.add('before', [raw()]);
    const connection = deferred<string>();
    client.connectionId.mockImplementationOnce(async () => connection.promise);
    const request = service.results('before', { requestId: 'early-navigation' });
    const observed = request.catch((error) => error as Error);
    service.cancel('early-navigation');
    connection.resolve('tenant-a');
    expect(await observed).toMatchObject({ name: 'AbortError' });
    expect(client.getScan).not.toHaveBeenCalled();
    expect(client.getAllResults).not.toHaveBeenCalled();
    expect(store.snapshot('tenant-a', 'before')).toBeNull();
  });

  it('rejects a connection change during import without saving mixed evidence', async () => {
    const { store, client, service } = open();
    client.add('before', [raw()]);
    const pending = deferred<Report>();
    client.getAllResults.mockImplementationOnce(async () => pending.promise);
    const request = service.results('before');
    const observed = request.catch((error) => error as Error);
    await vi.waitFor(() => expect(client.getAllResults).toHaveBeenCalledTimes(1));
    client.connection = 'tenant-b';
    pending.resolve(client.reports.get('before')!);
    expect(await observed).toMatchObject({ message: expect.stringContaining('Connection changed') });
    expect(store.snapshot('tenant-a', 'before')).toBeNull();
    expect(store.snapshot('tenant-b', 'before')).toBeNull();
  });

  it('rejects invalid selection and rolls back a session whose original evidence cannot be pinned', async () => {
    const { store, client, service } = open();
    client.add('before', [raw()]);
    await expect(service.createSession({ title: 'Invalid', scanId: 'before', findingIds: ['not-in-scan'] })).rejects.toThrow('outside the baseline');
    expect(store.sessions('tenant-a')).toEqual([]);
    vi.spyOn(store, 'saveSessionSnapshot').mockImplementationOnce(() => { throw new Error('Disk write failed'); });
    await expect(service.createSession({ title: 'Unpinned', scanId: 'before', findingIds: ['finding'] })).rejects.toThrow('Disk write failed');
    expect(store.sessions('tenant-a')).toEqual([]);
  });

  it('does not verify an empty rescan when effective provenance is missing', async () => {
    const { client, service } = open();
    client.add('before', [raw()]);
    client.add('after', []);
    const session = await service.createSession({ title: 'Unqualified scan', scanId: 'before', findingIds: ['finding'] });
    const verification = await service.verify(session.id, 'after');
    expect(verification.status).toBe('unresolved');
    expect(verification.verification?.comparison.verdict).toBe('inconclusive');
    expect(verification.verification?.comparison.reasons.join(' ')).toContain('provenance');
  });

  it.each(['unknown-severity', 'incomplete-results'] as const)('does not verify %s despite qualified scan configuration', async (condition) => {
    const { store, client, service } = open();
    qualifiedJob(store, 'before');
    qualifiedJob(store, 'after');
    client.add('before', [raw('finding', { severity: condition === 'unknown-severity' ? 'UNRECOGNIZED' : 'HIGH' })], { qualified: true });
    client.add('after', [], { qualified: true, incomplete: condition === 'incomplete-results' });
    const session = await service.createSession({ title: condition, scanId: 'before', findingIds: ['finding'] });
    expect((await service.verify(session.id, 'after')).status).toBe('unresolved');
  });

  it('keeps an SCA target unresolved when the same CVE survives a version change at lower severity', async () => {
    const { store, client, service } = open();
    qualifiedJob(store, 'before', ['sca']);
    qualifiedJob(store, 'after', ['sca']);
    const dependency = (version: string, severity: string) => raw('CVE-2026-1234', { type: 'sca', severity, vulnerabilityDetails: { cveName: 'CVE-2026-1234' }, data: { packageIdentifier: { name: 'library', version, packageManager: 'npm' } } });
    client.add('before', [dependency('1.0.0', 'HIGH')], { qualified: true, scanners: ['sca'] });
    client.add('after', [dependency('2.0.0', 'MEDIUM')], { qualified: true, scanners: ['sca'] });
    const session = await service.createSession({ title: 'Dependency upgrade', scanId: 'before', findingIds: ['CVE-2026-1234'] });
    const verification = await service.verify(session.id, 'after');
    expect(verification.verification?.comparison.verdict).toBe('pass');
    expect(verification.status).toBe('unresolved');
    expect(verification.verification?.remainingIds).toEqual(['CVE-2026-1234']);
    expect(verification.verification?.absentIds).toEqual([]);
  });

  it('verifies selected absence only with qualified comparable evidence and persists that result', async () => {
    const { store, client, service } = open();
    qualifiedJob(store, 'before');
    qualifiedJob(store, 'after');
    client.add('before', [raw()], { qualified: true });
    client.add('after', [], { qualified: true });
    const session = await service.createSession({ title: 'Qualified fix', scanId: 'before', findingIds: ['finding'] });
    const verification = await service.verify(session.id, 'after');
    expect(verification.status).toBe('verified');
    expect(verification.verification?.remainingIds).toEqual([]);
    expect((await service.session(session.id)).status).toBe('verified');
    const bundle = await service.bundle(session.id);
    expect(bundle.baseline.findings).toHaveLength(1);
    expect(bundle.verification?.findings).toEqual([]);
    await expect(service.updateSession({ id: session.id, status: 'verified' })).rejects.toThrow('Only a scan comparison');
  });

  it('keeps the previous verification and its evidence together when the session write fails', async () => {
    const { file, store, client, service } = open();
    for (const id of ['before', 'after', 'latest']) qualifiedJob(store, id);
    client.add('before', [raw()], { qualified: true });
    client.add('after', [], { qualified: true });
    client.add('latest', [raw()], { qualified: true });
    const session = await service.createSession({ title: 'Atomic verification', scanId: 'before', findingIds: ['finding'] });
    await service.verify(session.id, 'after');
    const db = new DatabaseSync(file);
    try {
      db.exec("CREATE TRIGGER reject_session_update BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT,'Session update rejected'); END");
      await expect(service.verify(session.id, 'latest')).rejects.toThrow('Session update rejected');
      const bundle = await service.bundle(session.id);
      expect(bundle.session.status).toBe('verified');
      expect(bundle.session.verification?.scanId).toBe('after');
      expect(bundle.verification?.scan?.id).toBe('after');
    } finally {
      db.close();
    }
  });
});
