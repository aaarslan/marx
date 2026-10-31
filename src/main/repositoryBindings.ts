import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RepositoryBinding } from '@shared/types';

export class RepositoryBindings {
  constructor(private readonly file: string) {}

  private read(): RepositoryBinding[] {
    try {
      if (fs.statSync(this.file).size > 1024 * 1024) throw new Error('Repository bindings exceed the supported size.');
      const rows: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(rows) || rows.some((row) => !row || ['folderPath', 'projectId', 'projectName', 'connectionId'].some((key) => typeof row[key] !== 'string'))) throw new Error('Repository bindings are invalid.');
      return rows;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  get(folderPath: string, connectionId: string): RepositoryBinding | null {
    return this.read().find((row) => row.folderPath === folderPath && row.connectionId === connectionId) ?? null;
  }

  folders(): string[] {
    return [...new Set(this.read().map((row) => row.folderPath))];
  }

  save(binding: RepositoryBinding): RepositoryBinding {
    const rows = this.read().filter((row) => row.folderPath !== binding.folderPath || row.connectionId !== binding.connectionId);
    if (rows.length >= 1000) throw new Error('Repository mapping limit reached.');
    rows.push(binding);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(rows, null, 2), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } finally { fs.rmSync(temporary, { force: true }); }
    return binding;
  }
}
