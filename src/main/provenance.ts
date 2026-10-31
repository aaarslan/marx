import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_EXCLUDES, type ScanOptions } from '@shared/types';
import type { ScanProvenance, SourceProvenance } from '@shared/workbench';

const MAX_FILES = 20_000;
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function fingerprintScanOptions(options: ScanOptions): string {
  return createHash('sha256').update(JSON.stringify(canonical({
    scanners: [...options.scanners].sort(), sastPreset: options.sastPreset,
    sastIncremental: options.sastIncremental, sastBaseBranch: options.sastBaseBranch || undefined,
    scaExploitablePath: options.scaExploitablePath, excludes: options.excludes
  }))).digest('hex');
}

function git(folder: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', folder, '-c', 'core.fsmonitor=false', ...args], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

async function folderFiles(root: string, options: ScanOptions): Promise<string[]> {
  const ignored = new Set(DEFAULT_EXCLUDES);
  for (const raw of options.excludes) {
    const value = raw.trim();
    if (value.startsWith('!')) ignored.delete(value.slice(1));
    else if (value && !/[?*\[\]]/.test(value)) ignored.add(value.replace(/\/$/, ''));
  }
  const found: string[] = [];
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (depth > 40) throw new Error('Source fingerprint exceeded the directory depth limit.');
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.name === '.git' || ignored.has(entry.name) || ignored.has(name.replaceAll(path.sep, '/'))) continue;
      if (entry.isDirectory()) await walk(name, depth + 1);
      else {
        found.push(name);
        if (found.length > MAX_FILES) throw new Error('Source fingerprint exceeded 20,000 files.');
      }
    }
  };
  await walk('', 0);
  return found;
}

async function fingerprint(root: string, files: string[]): Promise<{ fingerprint: string; files: number }> {
  const unique = [...new Set(files)].sort();
  if (unique.length > MAX_FILES) throw new Error('Source fingerprint exceeded 20,000 files.');
  const hash = createHash('sha256');
  let total = 0;
  for (const relative of unique) {
    const target = path.resolve(root, relative);
    const within = path.relative(root, target);
    if (path.isAbsolute(relative) || within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) throw new Error('Source fingerprint encountered a path outside the selected folder.');
    hash.update(JSON.stringify(relative.replaceAll(path.sep, '/')));
    let stat;
    try { stat = await fs.lstat(target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { hash.update(':deleted\n'); continue; }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      hash.update(`:link:${JSON.stringify(await fs.readlink(target))}\n`);
      continue;
    }
    if (!stat.isFile()) throw new Error('Source fingerprint contains a submodule or unsupported file type.');
    if (stat.size > MAX_FILE_BYTES || total + stat.size > MAX_BYTES) throw new Error('Source fingerprint exceeded its 16 MiB per-file or 256 MiB total limit.');
    const handle = await fs.open(target, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(MAX_FILE_BYTES + 1, stat.size + 1));
      let bytes = 0;
      while (bytes < buffer.length) {
        const chunk = await handle.read(buffer, bytes, buffer.length - bytes, null);
        if (!chunk.bytesRead) break;
        bytes += chunk.bytesRead;
      }
      const after = await handle.stat();
      if (bytes !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || after.size !== stat.size) throw new Error('Source changed while its fingerprint was being captured.');
      total += bytes;
      hash.update(`:file:${stat.mode & 0o777}:${bytes}:`).update(buffer.subarray(0, bytes)).update('\n');
    } finally { await handle.close(); }
  }
  return { fingerprint: hash.digest('hex'), files: unique.length };
}

export async function captureProvenance(folder: string, options: ScanOptions, connectionId: string, cliVersion?: string): Promise<ScanProvenance> {
  const root = await fs.realpath(folder);
  const capturedAt = Date.now();
  const source: SourceProvenance = { folderPath: root, branch: options.branch, dirty: true, capturedAt, snapshot: false };
  let beforeStatus: string | undefined;
  try {
    source.repositoryRoot = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
    try { source.commit = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim(); } catch {}
    try { source.branch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim(); }
    catch { source.branch = 'HEAD'; }
    beforeStatus = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
    source.dirty = Boolean(beforeStatus);
    source.fingerprintScope = 'git-visible-files';
  } catch {
    source.fingerprintScope = 'folder-files';
  }
  try {
    const files = source.repositoryRoot
      ? (await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'])).split('\0').filter(Boolean)
      : await folderFiles(root, options);
    const captured = await fingerprint(root, files);
    if (beforeStatus !== undefined && await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']) !== beforeStatus) throw new Error('Source changed while its fingerprint was being captured.');
    if (source.commit && (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim() !== source.commit) throw new Error('Git revision changed while its fingerprint was being captured.');
    source.fingerprint = captured.fingerprint;
    source.capturedFiles = captured.files;
    source.captureWarning = source.repositoryRoot
      ? 'Fingerprint covers tracked and untracked nonignored files. It is not an immutable archive or proof of the CLI upload contents.'
      : 'Fingerprint covers folder files within capture limits and literal exclusions. It is not an immutable archive or proof of the CLI upload contents.';
  } catch (error) {
    source.captureWarning = `${error instanceof Error ? error.message : String(error)} Source fingerprint is unavailable.`;
  }
  const normalizedOptions = { ...options, scanners: [...options.scanners].sort(), tags: { ...options.tags }, excludes: [...options.excludes] };
  return {
    version: 1, connectionId, capturedAt, cliVersion, source, options: normalizedOptions,
    optionsFingerprint: fingerprintScanOptions(normalizedOptions),
    requestedScanners: [...options.scanners].sort()
  };
}
