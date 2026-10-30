import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipFolder } from '../src/main/zipSource';
import { readSourceSnippet } from '../src/main/sourceSnippet';
import { CxOneClient } from '../src/main/cxone/client';
import type { CxCliClient } from '../src/main/cxone/cli';
import { CliBusyError } from '../src/main/cliProcess';
import { ScanRunner, summaryToCounts } from '../src/main/scanRunner';
import { execFileSync } from 'node:child_process';
import { getGitInfo, listSubProjects } from '../src/main/gitInfo';
import { BatchRunner } from '../src/main/batchRunner';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { makeJwt } from './helpers';

const temps: string[] = [];
async function fixture() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'marx-test-'));
  temps.push(folder);
  await fs.writeFile(path.join(folder, 'source.ts'), 'const answer = 42;\n');
  return folder;
}
afterEach(async () => { vi.useRealTimers(); await Promise.all(temps.splice(0).map((f) => fs.rm(f, { recursive: true, force: true }))); });
const apiKey = makeJwt({ aud: 'https://acme.iam.checkmarx.net/auth/realms/acme' });
const token = makeJwt({ 'ast-base-url': 'https://acme.ast.checkmarx.net' });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const input = (folderPath: string) => ({ folderPath, projectName: 'test', projectId: 'p1', options: { ...DEFAULT_SETTINGS.defaults, branch: 'main', excludes: [], tags: {} } });

describe('review regressions', () => {
  it('deduplicates concurrent authentication and retries a 401 only once', async () => {
    let auth = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('openid-connect')) { auth++; await new Promise((r) => setTimeout(r, 2)); return response({ access_token: token, expires_in: 3600 }); }
      return response({ totalCount: 0, projects: [] });
    });
    const client = new CxOneClient({ apiKey }, fetcher as typeof fetch);
    await Promise.all(Array.from({ length: 8 }, () => client.listProjects()));
    expect(auth).toBe(1);
    const unauthorized = vi.fn(async (url: string | URL | Request) => String(url).includes('openid-connect') ? response({ access_token: token, expires_in: 3600 }) : response({}, 401));
    await expect(new CxOneClient({ apiKey }, unauthorized as typeof fetch).listProjects()).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledTimes(4);
  });

  it('fetches all pages without totalCount, preserves caps, and reports truncation', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('openid-connect')) return response({ access_token: token, expires_in: 3600 });
      const params = new URL(String(url)).searchParams;
      const offset = Number(params.get('offset'));
      const limit = Number(params.get('limit'));
      return response({ results: Array.from({ length: Math.min(limit, offset < 200 ? 100 : 3) }, (_, i) => ({ id: String(offset + i) })) });
    });
    const client = new CxOneClient({ apiKey }, fetcher as typeof fetch);
    expect((await client.getAllResults('s')).results).toHaveLength(203);
    expect(await client.getAllResults('s', 150)).toMatchObject({ truncated: true, results: expect.any(Array) });
    expect((await client.getAllResults('s', 150)).results).toHaveLength(150);
  });

  it('streams real upload bytes through fetch with duplex and propagates failures', async () => {
    const folder = await fixture();
    let received = '';
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect((init as RequestInit & { duplex: string }).duplex).toBe('half');
      received = await new Response(init?.body).text();
      return new Response('', { status: 200 });
    });
    const client = new CxOneClient({ apiKey }, fetcher as typeof fetch);
    const progress: number[] = [];
    await client.uploadZip('https://example.com/upload', { path: path.join(folder, 'source.ts'), bytes: 19 }, (n) => progress.push(n));
    expect(received).toBe('const answer = 42;\n');
    expect(progress.at(-1)).toBe(Buffer.byteLength(received));
    await expect(client.uploadZip('https://example.com/upload', { path: path.join(folder, 'missing'), bytes: 1 })).rejects.toThrow();
  });

  it('writes a valid zip on disk, excludes nested dependencies, and removes it', async () => {
    const folder = await fixture();
    await fs.mkdir(path.join(folder, 'node_modules'));
    await fs.writeFile(path.join(folder, 'node_modules', 'skip'), 'skip');
    const progress: number[] = [];
    const zip = await zipFolder({ folder, excludes: ['node_modules'], onProgress: (n) => progress.push(n) });
    expect(zip.fileCount).toBe(1);
    expect((await fs.readFile(zip.path)).subarray(0, 2).toString()).toBe('PK');
    expect(progress.some((n) => n > 0)).toBe(true);
    await zip.cleanup();
    await expect(fs.stat(zip.path)).rejects.toThrow();
    await expect(zipFolder({ folder, excludes: [], maxBytes: 1 })).rejects.toThrow('single-upload limit');
    await expect(zipFolder({ folder, excludes: [], signal: AbortSignal.abort() })).rejects.toThrow();
  });

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
    const client = { createUploadUrl: vi.fn(async () => 'https://s3/upload'), uploadZip: vi.fn(async () => undefined), createScan: vi.fn(() => new Promise((r) => { release = r; })), cancelScan: vi.fn(async () => undefined), getScan: vi.fn() };
    const runner = new ScanRunner(() => client as unknown as CxCliClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const job = runner.newJob(input(folder));
    const pending = runner.run(job);
    expect(runner.run(job)).toBe(pending);
    await vi.waitFor(() => expect(client.createScan).toHaveBeenCalledOnce());
    await runner.cancelJob(job);
    release({ id: 's1', status: 'Queued' });
    expect((await pending).progress.phase).toBe('canceled');
    expect(client.cancelScan).toHaveBeenCalledWith('s1');
    expect(client.getScan).not.toHaveBeenCalled();
  });

  it('ignores a late in-flight poll after cancellation', async () => {
    const folder = await fixture();
    let release!: (scan: { id: string; status: string }) => void;
    const client = { createUploadUrl: vi.fn(async () => 'https://s3/upload'), uploadZip: vi.fn(async () => undefined), createScan: vi.fn(async () => ({ id: 's1', status: 'Queued' })), cancelScan: vi.fn(async () => undefined), getScan: vi.fn(() => new Promise((r) => { release = r; })), getScanSummary: vi.fn() };
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
  });

  it('caps parallel result pages at three and exposes the true total', async () => {
    let active = 0;
    let peak = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('openid-connect')) return response({ access_token: token, expires_in: 3600 });
      const params = new URL(String(url)).searchParams;
      const offset = Number(params.get('offset'));
      const limit = Number(params.get('limit'));
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return response({ totalCount: 603, results: Array.from({ length: Math.min(limit, 603 - offset) }, (_, i) => ({ id: String(offset + i) })) });
    });
    const page = await new CxOneClient({ apiKey }, fetcher as typeof fetch).getAllResults('s', 450);
    expect(page).toMatchObject({ totalCount: 603, truncated: true });
    expect(page.results).toHaveLength(450);
    expect(peak).toBe(3);
    expect(new Set(page.results.map((r) => r.id)).size).toBe(450);
  });

  it('rejects insecure endpoints before sending credentials', async () => {
    const fetcher = vi.fn(async () => response({ access_token: token, expires_in: 3600 }));
    await expect(new CxOneClient({ apiKey, baseUrl: 'http://api.example.com' }, fetcher).listProjects()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const client = new CxOneClient({ apiKey: makeJwt({ aud: 'http://auth.example.com/realm' }) }, fetcher);
    fetcher.mockClear();
    await expect(client.listProjects()).rejects.toThrow('HTTPS');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('settles a vanishing zip entry and aborts during progress without hanging', async () => {
    const folder = await fixture();
    const disappearing = path.join(folder, 'vanishing.ts');
    await fs.writeFile(disappearing, 'temporary');
    const zip = await zipFolder({ folder, excludes: [], onProgress: () => { try { unlinkSync(disappearing); } catch {} } });
    expect(zip.fileCount).toBe(1);
    await zip.cleanup();
    const controller = new AbortController();
    await expect(zipFolder({ folder, excludes: [], signal: controller.signal, onProgress: () => controller.abort() })).rejects.toThrow();
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
      cancelScan: vi.fn(async () => undefined)
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
