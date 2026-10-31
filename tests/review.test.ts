import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSourceSnippet } from '../src/main/sourceSnippet';
import type { CxCliClient } from '../src/main/cxone/cli';
import { CliBusyError } from '../src/main/cliProcess';
import { ScanRunner, summaryToCounts } from '../src/main/scanRunner';
import { execFileSync } from 'node:child_process';
import { getGitInfo, listSubProjects } from '../src/main/gitInfo';
import { BatchRunner } from '../src/main/batchRunner';
import { DEFAULT_SETTINGS } from '../src/shared/types';

const temps: string[] = [];
async function fixture() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'marx-test-'));
  temps.push(folder);
  await fs.writeFile(path.join(folder, 'source.ts'), 'const answer = 42;\n');
  return folder;
}
afterEach(async () => { vi.useRealTimers(); await Promise.all(temps.splice(0).map((f) => fs.rm(f, { recursive: true, force: true }))); });
const input = (folderPath: string) => ({ folderPath, projectName: 'test', projectId: 'p1', options: { ...DEFAULT_SETTINGS.defaults, branch: 'main', excludes: [], tags: {} } });

describe('review regressions', () => {
  it('rejects sibling traversal and symlink escape and clamps snippet lines', async () => {
    const folder = await fixture();
    const sibling = await fixture();
    await fs.symlink(sibling, path.join(folder, 'escape'));
    await expect(readSourceSnippet(folder, 'escape/source.ts')).rejects.toThrow('Invalid path');
    await expect(readSourceSnippet(folder, path.relative(folder, path.join(sibling, 'source.ts')))).rejects.toThrow('Invalid path');
    await expect(readSourceSnippet(folder, path.join(sibling, 'source.ts'))).rejects.toThrow('Invalid path');
    expect(await readSourceSnippet(folder, 'source.ts', Infinity)).toMatchObject({ startLine: 1, totalLines: 2 });
  });

  it('does not present an unavailable summary as zero vulnerabilities', () => {
    expect(summaryToCounts(null)).toBeNull();
    expect(summaryToCounts({ scans: [{ sastCounters: {} }] })).toBeNull();
    expect(summaryToCounts({ critical: 1, high: 2, medium: 0, low: 0, info: 0 })).toMatchObject({ CRITICAL: 1, HIGH: 2 });
  });

  it('deduplicates a job and cancels a scan created after cancellation', async () => {
    const folder = await fixture();
    let release!: (scan: { id: string; status: string }) => void;
    const client = { createScan: vi.fn(() => new Promise((r) => { release = r; })), cancelScan: vi.fn(async () => undefined), getScan: vi.fn(async () => ({ id: 's1', status: 'Canceled' })) };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const job = runner.newJob(input(folder));
    const pending = runner.run(job);
    expect(runner.run(job)).toBe(pending);
    await vi.waitFor(() => expect(client.createScan).toHaveBeenCalledOnce());
    await runner.cancelJob(job);
    release({ id: 's1', status: 'Queued' });
    expect((await pending).progress.phase).toBe('canceled');
    expect(client.cancelScan).toHaveBeenCalledWith('s1');
    expect(client.getScan).toHaveBeenCalledExactlyOnceWith('s1');
  });

  it('ignores a late in-flight poll after cancellation', async () => {
    const folder = await fixture();
    let release!: (scan: { id: string; status: string }) => void;
    const client = { createScan: vi.fn(async () => ({ id: 's1', status: 'Queued' })), cancelScan: vi.fn(async () => undefined), getScan: vi.fn().mockImplementationOnce(() => new Promise((r) => { release = r; })).mockResolvedValueOnce({ id: 's1', status: 'Canceled' }), getScanSummary: vi.fn() };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const job = runner.newJob(input(folder));
    const pending = runner.run(job);
    await vi.waitFor(() => expect(client.getScan).toHaveBeenCalledOnce());
    await runner.cancelJob(job);
    release({ id: 's1', status: 'Completed' });
    expect((await pending).progress.phase).toBe('canceled');
    expect(client.getScanSummary).not.toHaveBeenCalled();
  });

  it('bounds batch concurrency, rejects overlap, and skips canceled waiting jobs', async () => {
    const folder = await fixture();
    let active = 0;
    let peak = 0;
    const client = { createUploadUrl: async () => 'https://s3/upload', uploadZip: async () => undefined, createScan: async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { id: 's1', status: 'Queued' };
    }, getScan: async () => ({ id: 's1', status: 'Completed' }), getScanSummary: async () => null, cancelScan: async () => undefined };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const batch = new BatchRunner(runner, vi.fn());
    const pending = batch.runAll(Array.from({ length: 5 }, () => input(folder)), 2);
    await expect(batch.runAll([], 1)).rejects.toThrow('already running');
    await runner.cancelJob(batch.getJobs()[4]);
    const jobs = await pending;
    expect(peak).toBe(2);
    expect(new Set(jobs.map((j) => j.batchId)).size).toBe(1);
    expect(jobs[0].batchId).toBeTruthy();
    expect(jobs[4].status).toBe('Canceled');
    expect(jobs.slice(0, 4).every((j) => j.status === 'Completed')).toBe(true);
  });
  it('reports remote cancellation failure instead of claiming a confirmed stop', async () => {
    const folder = await fixture();
    let release!: (scan: { id: string; status: string }) => void;
    const client = { createUploadUrl: async () => 'https://s3/upload', uploadZip: async () => undefined, createScan: vi.fn(() => new Promise((r) => { release = r; })), cancelScan: vi.fn(async () => { throw new Error('service unavailable'); }) };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const job = runner.newJob(input(folder));
    const pending = runner.run(job);
    await vi.waitFor(() => expect(client.createScan).toHaveBeenCalledOnce());
    await runner.cancelJob(job);
    release({ id: 's1', status: 'Queued' });
    expect((await pending).error).toContain('remote cancellation is unconfirmed');
    expect(job.status).toBe('Unknown');
    expect(job.monitoringStatus).toBe('stopped');
  });

  it('detects branches before the first commit and discovers only project subfolders', async () => {
    const parent = await fixture();
    const repo = path.join(parent, 'new-project');
    await fs.mkdir(repo);
    execFileSync('git', ['init', '--initial-branch=review-story', repo], { stdio: 'ignore' });
    await fs.mkdir(path.join(parent, 'not-a-project'));
    expect(await getGitInfo(repo)).toMatchObject({ branch: 'review-story', hasGit: true });
    expect(listSubProjects(parent)).toEqual([repo]);
    execFileSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Review', '-c', 'user.email=review@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach'], { stdio: 'ignore' });
    expect(await getGitInfo(repo)).toMatchObject({ branch: 'HEAD', hasGit: true });
    expect((await getGitInfo(parent)).hasGit).toBe(false);
  });

  it('cancels once when a CLI interruption follows a streamed scan ID', async () => {
    const folder = await fixture();
    const client = {
      createScan: vi.fn(async (_job, signal, events) => {
        events.onStarting();
        events.onSubmitted({ id: 'streamed-scan', projectId: 'p1', status: 'Queued' });
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('CLI canceled')), { once: true }));
      }),
      cancelScan: vi.fn(async () => undefined),
      getScan: vi.fn(async () => ({ id: 'streamed-scan', status: 'Canceled' }))
    };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const job = runner.newJob(input(folder));
    const pending = runner.run(job);
    await vi.waitFor(() => expect(job.scanId).toBe('streamed-scan'));
    await runner.cancelJob(job);
    expect((await pending).status).toBe('Canceled');
    expect(job.error).not.toContain('unconfirmed');
    expect(client.cancelScan).toHaveBeenCalledExactlyOnceWith('streamed-scan');
  });

  it('does not describe a failed read-only preflight as an uncertain submission', async () => {
    const folder = await fixture();
    const client = { createScan: vi.fn(async () => { throw new Error('Selected project no longer exists'); }) };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const job = await runner.run(runner.newJob(input(folder)));
    expect(job.status).toBe('Failed');
    expect(job.error).toBe('Selected project no longer exists');
  });

  it('retries local capacity failures and waits through an initial New status', async () => {
    const folder = await fixture();
    vi.useFakeTimers();
    const client = {
      createScan: vi.fn(async () => ({ id: 's1', projectId: 'p1', status: 'New' })),
      getScan: vi.fn().mockRejectedValueOnce(new CliBusyError()).mockResolvedValueOnce({ id: 's1', status: 'New' }).mockResolvedValueOnce({ id: 's1', status: 'Completed' }),
      getScanSummary: vi.fn(async () => null)
    };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const pending = runner.run(runner.newJob(input(folder)));
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe('Completed');
    expect(client.getScan).toHaveBeenCalledTimes(3);
  });

  it('bounds capacity retries without claiming a remote scan failed', async () => {
    const folder = await fixture();
    vi.useFakeTimers();
    const client = { createScan: async () => ({ id: 's1', projectId: 'p1', status: 'Queued' }), getScan: vi.fn(async () => { throw new CliBusyError(); }) };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const started = Date.now();
    const pending = runner.run(runner.newJob(input(folder)));
    await vi.runAllTimersAsync();
    const job = await pending;
    expect(job.status).toBe('Unknown');
    expect(job.progress.phase).toBe('failed');
    expect(job.error).toContain('Local monitoring stopped');
    expect(client.getScan).toHaveBeenCalledTimes(6);
    expect(Date.now() - started).toBeLessThan(60_000);
  });

  it('requires repeated unknown statuses before stopping monitoring', async () => {
    const folder = await fixture();
    vi.useFakeTimers();
    const client = { createScan: async () => ({ id: 's1', projectId: 'p1', status: 'Queued' }), getScan: vi.fn(async () => ({ id: 's1', status: 'Unrecognized' })) };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const pending = runner.run(runner.newJob(input(folder)));
    await vi.runAllTimersAsync();
    const job = await pending;
    expect(job.status).toBe('Unknown');
    expect(job.error).toContain('repeatedly reported an unrecognized');
    expect(client.getScan).toHaveBeenCalledTimes(3);
  });

  it('logs a summary failure while preserving a remotely completed scan', async () => {
    const folder = await fixture();
    const client = { createScan: async () => ({ id: 's1', projectId: 'p1', status: 'Queued' }), getScan: async () => ({ id: 's1', status: 'Completed' }), getScanSummary: async () => { throw new Error('CLI report request failed (401)'); } };
    const log = vi.fn();
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: log });
    const job = await runner.run(runner.newJob(input(folder)));
    expect(job.status).toBe('Completed');
    expect(job.summary).toBeUndefined();
    expect(job.progress.detail).toContain('Summary unavailable');
    expect(log.mock.calls.some(([, line]) => line.includes('CLI report request failed (401)'))).toBe(true);
  });

});
