import { ZipArchive } from 'archiver';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export interface ZipOptions {
  folder: string;
  excludes: string[];
  signal?: AbortSignal;
  maxBytes?: number;
  compressionLevel?: number;
  onProgress?: (bytesZipped: number, fileCount: number) => void;
}

export interface ZipResult {
  path: string;
  bytes: number;
  fileCount: number;
  cleanup: () => Promise<void>;
}

export function isExcluded(entryPath: string, excludes: string[]): boolean {
  if (!entryPath) return false;
  const names = new Set(excludes.map((e) => e.trim()).filter(Boolean));
  return entryPath.split('/').some((segment) => names.has(segment));
}

export async function zipFolder(opts: ZipOptions): Promise<ZipResult> {
  opts.signal?.throwIfAborted();
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'marx-source-'));
  const target = path.join(temp, 'source.zip');
  const cleanup = () => fsp.rm(temp, { recursive: true, force: true });
  const archive = new ZipArchive({ zlib: { level: opts.compressionLevel ?? 3 } });
  const sink = fs.createWriteStream(target, { mode: 0o600 });
  let fileCount = 0;
  let failure: Error | undefined;
  const fail = (err: Error) => {
    failure ??= err;
    archive.abort();
    archive.destroy(err);
  };
  archive.on('warning', (err) => { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') fail(err); });
  archive.on('data', () => {
    if (archive.pointer() > (opts.maxBytes ?? 900 * 1024 * 1024)) {
      fail(new Error('Zipped source exceeds the single-upload limit. Add more excludes and try again.'));
    }
  });
  const abort = () => fail(new Error('Scan canceled'));
  opts.signal?.addEventListener('abort', abort, { once: true });
  const written = pipeline(archive, sink);
  void written.catch(() => undefined);
  try {
    const walk = async (abs: string, rel: string): Promise<void> => {
      const dir = await fsp.opendir(abs);
      for await (const entry of dir) {
        opts.signal?.throwIfAborted();
        if (failure) throw failure;
        const name = rel ? `${rel}/${entry.name}` : entry.name;
        if (isExcluded(name, opts.excludes)) continue;
        const source = path.join(abs, entry.name);
        if (entry.isDirectory()) await walk(source, name);
        else if (entry.isFile()) {
          const added = await new Promise<boolean>((resolve, reject) => {
            const clear = () => { archive.off('error', error); archive.off('entry', done); archive.off('warning', warning); };
            const done = () => { clear(); resolve(true); };
            const error = (err: Error) => { clear(); reject(err); };
            const warning = (err: Error) => { if ((err as NodeJS.ErrnoException).code === 'ENOENT') { clear(); resolve(false); } };
            archive.once('entry', done);
            archive.once('error', error);
            archive.on('warning', warning);
            archive.file(source, { name });
          });
          if (added) fileCount++;
          opts.onProgress?.(archive.pointer(), fileCount);
        }
      }
    };
    await walk(opts.folder, '');
    await archive.finalize();
    await written;
    if (failure) throw failure;
    return { path: target, bytes: (await fsp.stat(target)).size, fileCount, cleanup };
  } catch (err) {
    archive.abort();
    archive.destroy();
    sink.destroy();
    await written.catch(() => undefined);
    await cleanup();
    throw err;
  } finally {
    opts.signal?.removeEventListener('abort', abort);
  }
}
