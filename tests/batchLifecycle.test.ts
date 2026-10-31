import { describe, expect, it, vi } from 'vitest';
import { BatchRunner } from '../src/main/batchRunner';
import { ScanRunner, type RunJobInput } from '../src/main/scanRunner';
import type { CxCliClient } from '../src/main/cxone/cli';

const input: RunJobInput = { folderPath: '/repo', projectName: 'Project', options: { scanners: ['sast'], branch: 'main', sastPreset: '', sastIncremental: false, scaExploitablePath: false, excludes: [], tags: {} } };

describe('batch preparation', () => {
  it('does not submit when durable preparation fails and permits a later attempt', async () => {
    const createScan = vi.fn(async () => ({ id: 'scan', status: 'Queued', projectId: 'project' }));
    const client = { createScan, getScan: vi.fn(async () => ({ id: 'scan', status: 'Completed' })), getScanSummary: vi.fn(async () => null) };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const persisted = vi.fn().mockImplementationOnce(() => { throw new Error('Disk full'); });
    const batch = new BatchRunner(runner, vi.fn(), persisted);
    expect(() => batch.startAll([input], 1)).toThrow('Disk full');
    expect(createScan).not.toHaveBeenCalled();
    expect(batch.isRunning()).toBe(false);
    const next = batch.startAll([input], 1);
    expect(next.jobs).toHaveLength(1);
    await next.completion;
    expect(createScan).toHaveBeenCalledTimes(1);
    expect(batch.isRunning()).toBe(false);
  });
});
