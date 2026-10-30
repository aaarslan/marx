import fs from 'node:fs/promises';
import path from 'node:path';
import type { SourceSnippet } from '@shared/api-contract';

export async function readSourceSnippet(folder: string, relativePath: string, line = 1): Promise<SourceSnippet> {
  if (path.isAbsolute(relativePath)) throw new Error('Invalid path');
  const root = await fs.realpath(folder);
  const target = await fs.realpath(path.resolve(root, relativePath));
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Invalid path');
  }
  const handle = await fs.open(target, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Source file is too large or is not a regular file.');
    const buffer = Buffer.alloc(8 * 1024 * 1024 + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
    }
    if (bytes > 8 * 1024 * 1024) throw new Error('Source file is too large.');
    const content = buffer.subarray(0, bytes).toString('utf8');
    const lines = content.split('\n');
    const requested = Number.isFinite(line) ? Math.max(1, Math.min(lines.length, Math.floor(line))) : 1;
    const from = Math.max(0, requested - 8);
    const to = Math.min(lines.length, requested + 7);
    return { path: relative, startLine: from + 1, endLine: to, lines: lines.slice(from, to), totalLines: lines.length };
  } finally {
    await handle.close();
  }
}
