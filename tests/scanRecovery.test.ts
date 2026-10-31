import { describe, expect, it, vi } from 'vitest';
import { ScanRunner } from '../src/main/scanRunner';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import type { CxCliClient } from '../src/main/cxone/cli';

const input = { folderPath: '/fixture', projectId: 'p1', projectName: 'Project', connectionId: 'c1', options: { ...DEFAULT_SETTINGS.defaults, branch: 'main', excludes: [], tags: {} } };
const events = () => ({ onJobUpdated: vi.fn(), onLog: vi.fn() });

describe('remote scan reconciliation', () => {
  it('preserves an uncertain submission without a returned scan ID as Unknown', async () => {
    const client = { createScan: vi.fn(async (_job, _signal, events) => { events.onStarting(); throw new Error('connection lost before the response'); }) };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, events());
    const job = await runner.run(runner.newJob(input));
    expect(job).toMatchObject({ status: 'Unknown', monitoringStatus: 'stopped', error: expect.stringContaining('Remote submission is unconfirmed') });
    expect(job.scanId).toBeUndefined();
    expect(client.createScan).toHaveBeenCalledOnce();
    await expect(runner.reconcile(job)).rejects.toThrow('No remote scan ID');
    expect(client.createScan).toHaveBeenCalledOnce();
  });

  it('resumes a known scan without invoking submission', async () => {
    const client = { connectionId: async () => 'c1', createScan: vi.fn(), getScan: vi.fn(async () => ({ id: 's1', projectId: 'p1', status: 'Completed' })), getScanSummary: async () => null };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, events());
    const job = { ...runner.newJob(input), scanId: 's1', finishedAt: 1 };
    expect(await runner.reconcile(job)).toMatchObject({ status: 'Completed', monitoringStatus: 'stopped' });
    expect(client.createScan).not.toHaveBeenCalled();
    expect(client.getScan).toHaveBeenCalledWith('s1', expect.any(AbortSignal));
  });

  it('refuses to resubmit an uncertain job or reconcile on another connection', async () => {
    const client = { connectionId: async () => 'c2', createScan: vi.fn(), getScan: vi.fn() };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, events());
    await expect(runner.reconcile(runner.newJob(input))).rejects.toThrow('No remote scan ID');
    expect(await runner.reconcile({ ...runner.newJob(input), scanId: 's1' })).toMatchObject({ status: 'Unknown', monitoringStatus: 'stopped' });
    expect(client.createScan).not.toHaveBeenCalled();
    expect(client.getScan).not.toHaveBeenCalled();
  });

  it('does not claim cancellation when the remote service rejected it', async () => {
    let submitted!: (scan: { id: string; projectId: string; status: string }) => void;
    const client = { createScan: () => new Promise((resolve) => { submitted = resolve; }), cancelScan: async () => { throw new Error('offline'); } };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, events());
    const job = runner.newJob(input);
    const pending = runner.run(job);
    await runner.cancelJob(job);
    submitted({ id: 's1', projectId: 'p1', status: 'Queued' });
    expect(await pending).toMatchObject({ status: 'Unknown', monitoringStatus: 'stopped', error: expect.stringContaining('cancellation is unconfirmed') });
  });

  it('only records remote cancellation after checking the remote status', async () => {
    let submitted!: (scan: { id: string; projectId: string; status: string }) => void;
    const client = { createScan: () => new Promise((resolve) => { submitted = resolve; }), cancelScan: vi.fn(async () => {}), getScan: vi.fn(async () => ({ id: 's1', projectId: 'p1', status: 'Canceled' })) };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, events());
    const job = runner.newJob(input);
    const pending = runner.run(job);
    await runner.cancelJob(job);
    submitted({ id: 's1', projectId: 'p1', status: 'Queued' });
    expect(await pending).toMatchObject({ status: 'Canceled', error: 'Remote scan cancellation confirmed.' });
    expect(client.cancelScan).toHaveBeenCalledExactlyOnceWith('s1');
    expect(client.getScan).toHaveBeenCalledExactlyOnceWith('s1');
  });
});
