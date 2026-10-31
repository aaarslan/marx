import { Worker } from 'node:worker_threads';

const source = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
(async () => {
  const handle = await fs.open(workerData.file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > workerData.limit) throw new Error('The CLI report exceeds the 64 MiB import limit. Open the scan in Checkmarx One.');
    const buffer = Buffer.alloc(Math.min(workerData.limit + 1, stat.size + 1));
    let size = 0;
    while (size < buffer.length) {
      const result = await handle.read(buffer, size, buffer.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size !== stat.size) throw new Error('The CLI report changed during import. Refresh the scan.');
    const text = buffer.subarray(0, size).toString('utf8');
    const value = JSON.parse(text);
    if (workerData.format === 'sarif' && (value.version !== '2.1.0' || !Array.isArray(value.runs))) throw new Error('The CLI returned an unrecognized SARIF report.');
    parentPort.postMessage({ ok: true, value: workerData.format === 'sarif' ? text : value });
  } finally { await handle.close(); }
})().catch(error => parentPort.postMessage({ ok: false, error: error.message }));
`;

export function readCliReport(file: string, signal?: AbortSignal, format: 'json' | 'sarif' = 'json'): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new Error('Report import canceled.')); return; }
    const worker = new Worker(source, { eval: true, workerData: { file, format, limit: 64 * 1024 * 1024 }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 } });
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      clearTimeout(timeout);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(new Error('Report import canceled.'));
    const timeout = setTimeout(() => finish(new Error('Report import exceeded its 60-second processing limit.')), 60_000);
    worker.on('message', (message: { ok: boolean; value?: unknown; error?: string }) => finish(message.ok ? undefined : new Error(message.error ?? 'The CLI report could not be read.'), message.value));
    worker.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
    worker.on('exit', (code) => { if (!settled) finish(new Error(`Report import worker stopped before returning results (${code}).`)); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
