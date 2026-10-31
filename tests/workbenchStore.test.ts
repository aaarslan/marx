import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WorkbenchStore } from '../src/main/workbenchStore';
import type { Finding, ResultsPage, ScanJobState } from '../src/shared/types';
import type { RemediationSession } from '../src/shared/workbench';

const folders: string[] = [];
const stores: WorkbenchStore[] = [];
afterEach(() => { vi.restoreAllMocks(); stores.splice(0).forEach((store) => store.close()); folders.splice(0).forEach((folder) => fs.rmSync(folder, { recursive: true, force: true })); });
const open = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-store-'));
  folders.push(folder);
  const file = path.join(folder, 'workbench.sqlite');
  const store = new WorkbenchStore(file);
  stores.push(store);
  return { store, file };
};
const finding = (id: string): Finding => ({ id, scanId: 's1', projectId: 'p1', type: 'sast', label: 'SAST', similarityId: id, severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW', title: `Finding ${id}`, where: 'src/example.ts:2', description: 'evidence', flow: [] });
const page = (findings: Finding[], id = 's1'): ResultsPage => ({ scan: { id, projectId: 'p1', projectName: 'Project', branch: 'main', status: 'Completed', createdAt: '2026-01-01T00:00:00Z', updatedAt: '' }, findings: findings.map((f) => ({ ...f, scanId: id })), totalCount: findings.length });
const session = (): RemediationSession => ({ id: 'r1', connectionId: 'c1', title: 'Repair', baselineScanId: 's1', projectId: 'p1', projectName: 'Project', findingIds: ['f1'], status: 'open', createdAt: 1, updatedAt: 1, notes: '', changeRef: '', checks: '' });

describe('durable workbench evidence', () => {
  it('refuses a newer database schema without downgrading its version', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-newer-store-'));
    folders.push(folder);
    const file = path.join(folder, 'workbench.sqlite');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA user_version=99');
    db.close();
    expect(() => new WorkbenchStore(file)).toThrow('newer version');
    const verify = new DatabaseSync(file);
    expect(Number(verify.prepare('PRAGMA user_version').get()?.user_version)).toBe(99);
    verify.close();
  });

  it('isolates connections, persists full snapshots, and queries beyond the former cap', () => {
    const { store } = open();
    expect(store.hasSnapshot('c1', 's1')).toBe(false);
    const rows = Array.from({ length: 6001 }, (_, i) => finding(`f${i}`));
    store.saveSnapshot('c1', page(rows));
    store.saveSnapshot('c2', page([finding('other')]));
    expect(store.hasSnapshot('c1', 's1')).toBe(true);
    expect(store.hasSnapshot('missing', 's1')).toBe(false);
    expect(store.snapshot('c1', 's1')?.findings).toHaveLength(6001);
    expect(store.queryFindings('c1', 's1', { search: 'Finding f6000', limit: 10 })).toMatchObject({ totalCount: 6001, filteredCount: 1, findings: [{ id: 'f6000' }] });
    expect(store.queryFindings('c1', 's1', { offset: 6000, limit: 10 }).findings).toHaveLength(1);
    expect(store.snapshot('c2', 's1')?.findings[0].id).toBe('other');
  });

  it('rolls back an interrupted snapshot replacement', () => {
    const { store } = open();
    store.saveSnapshot('c1', page([finding('original')]));
    const broken = { ...finding('broken'), flow: undefined } as unknown as Finding;
    expect(() => store.saveSnapshot('c1', page([finding('replacement'), broken]))).toThrow();
    expect(store.snapshot('c1', 's1')?.findings.map((f) => f.id)).toEqual(['original']);
  });

  it('keeps session evidence immutable when the scan cache is refreshed', () => {
    const { store } = open();
    const original = store.saveSnapshot('c1', page([finding('f1')]));
    store.saveSession(session());
    store.saveSessionSnapshot('r1', 'baseline', original);
    const refreshed = store.saveSnapshot('c1', page([{ ...finding('f1'), state: 'CONFIRMED' }]));
    store.saveSessionSnapshot('r1', 'baseline', refreshed);
    expect(store.sessionSnapshot('r1', 'baseline')?.findings[0].state).toBe('TO_VERIFY');
    expect(store.snapshot('c1', 's1')?.findings[0].state).toBe('CONFIRMED');
    expect(() => store.deleteSnapshot('c1', 's1')).toThrow('referenced');
    store.deleteSession('r1');
    expect(store.sessionSnapshot('r1', 'baseline')).toBeNull();
    store.deleteSnapshot('c1', 's1');
    expect(store.snapshot('c1', 's1')).toBeNull();
  });

  it('rolls back session changes when pinning their evidence fails', () => {
    const { store } = open();
    const original = store.saveSnapshot('c1', page([finding('f1')]));
    store.saveSessionWithEvidence(session(), 'baseline', original);
    expect(() => store.saveSessionWithEvidence({ ...session(), notes: 'must not persist' }, 'verification', { ...original, connectionId: 'different' })).toThrow('different connection');
    expect(store.session('r1')?.notes).toBe('');
    expect(store.sessionSnapshot('r1', 'verification')).toBeNull();
    expect(store.sessionSnapshot('r1', 'baseline')?.findings[0].id).toBe('f1');
  });

  it('rolls back an initial batch if any job cannot be saved', () => {
    const { store } = open();
    const first = { id: 'j1', connectionId: 'c1', startedAt: 1 } as ScanJobState;
    const invalid = { id: undefined, connectionId: 'c1', startedAt: 1 } as unknown as ScanJobState;
    expect(() => store.saveJobs([first, invalid])).toThrow();
    expect(store.jobs()).toEqual([]);
  });

  it('persists a verification job and its session link atomically', () => {
    const { store } = open();
    store.saveSession(session());
    const job = { id: 'verification', connectionId: 'c1', projectId: 'p1', startedAt: 1 } as ScanJobState;
    expect(() => store.saveVerificationJob(job, { ...session(), baselineScanId: 'another', verificationJobId: job.id })).toThrow('cannot change');
    expect(store.jobs()).toEqual([]);
    expect(store.session('r1')?.verificationJobId).toBeUndefined();
    store.saveVerificationJob(job, { ...session(), verificationJobId: job.id });
    expect(store.jobs()[0].id).toBe(job.id);
    expect(store.session('r1')?.verificationJobId).toBe(job.id);
  });

  it('restores jobs, logs, and workspace state after closing the database', () => {
    const { store, file } = open();
    store.saveJob({ id: 'j1', connectionId: 'c1', scanId: 's1', startedAt: 1, status: 'Running', progress: { phase: 'running' } } as ScanJobState);
    store.appendLog('j1', 'Captured remote scan s1');
    store.saveWorkspace('c1:results', { selectedScanId: 's1', search: 'injection' });
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = new WorkbenchStore(file);
    stores.push(reopened);
    expect(reopened.jobs('c1')[0]).toMatchObject({ scanId: 's1', status: 'Running' });
    expect(reopened.jobs('c2')).toEqual([]);
    expect(reopened.logs('j1')).toEqual(['Captured remote scan s1']);
    expect(reopened.workspace('c1:results')).toMatchObject({ search: 'injection' });
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('retains session references and active jobs while pruning expired unreferenced evidence', () => {
    const { store } = open();
    const old = Date.now() - 40 * 86_400_000;
    vi.spyOn(Date, 'now').mockReturnValue(old);
    store.saveSnapshot('c1', page([finding('f1')]));
    store.saveSnapshot('c1', page([], 'orphan'));
    store.saveSession(session());
    store.saveJob({ id: 'active', connectionId: 'c1', startedAt: old } as ScanJobState);
    store.saveJob({ id: 'uncertain', connectionId: 'c1', startedAt: old, finishedAt: old, status: 'Unknown' } as ScanJobState);
    store.saveJob({ id: 'finished', connectionId: 'c1', startedAt: old, finishedAt: old, status: 'Completed' } as ScanJobState);
    vi.restoreAllMocks();
    expect(store.prune(30)).toEqual({ snapshots: 1, jobs: 1 });
    expect(store.snapshot('c1', 's1')).not.toBeNull();
    expect(store.jobs('c1').map((job) => job.id).sort()).toEqual(['active', 'uncertain']);
  });
});
