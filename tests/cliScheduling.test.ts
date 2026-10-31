import { describe, expect, it, vi } from 'vitest';
import { runCliProcess } from '../src/main/cliProcess';

describe('CLI scheduling', () => {
  it('queues reads, reserves control capacity, and cancels queued work before spawning', async () => {
    const controllers = Array.from({ length: 10 }, () => new AbortController());
    let ready = 0;
    const active = controllers.map((controller) => runCliProcess({
      executable: process.execPath,
      args: ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'],
      signal: controller.signal,
      onLine: (line) => { if (line === 'ready') ready++; }
    }).catch(() => undefined));
    let queued: Promise<string> | undefined;
    try {
      await vi.waitFor(() => expect(ready).toBe(10), { timeout: 5000 });
      const readStarted = vi.fn();
      queued = runCliProcess({ executable: process.execPath, args: ['-e', 'console.log("read")'], onLine: readStarted });
      const controller = new AbortController();
      const canceled = runCliProcess({ executable: process.execPath, args: ['-e', 'throw new Error("must not execute")'], signal: controller.signal });
      controller.abort();
      await expect(canceled).rejects.toThrow('before starting');
      expect(await runCliProcess({ executable: process.execPath, args: ['-e', 'console.log("control")'], priority: 'control' })).toContain('control');
      expect(readStarted).not.toHaveBeenCalled();
    } finally {
      controllers.forEach((controller) => controller.abort());
      await Promise.all(active);
    }
    expect(await queued).toContain('read');
  }, 10_000);
});
