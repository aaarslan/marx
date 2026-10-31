import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCliReport } from '../src/main/reportReader';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => fs.rm(folder, { recursive: true, force: true }))); });
const fixture = async (contents: string) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'marx-report-reader-'));
  folders.push(folder);
  const file = path.join(folder, 'report.json');
  await fs.writeFile(file, contents);
  return file;
};

describe('bounded report import', () => {
  it('parses in a worker and returns valid SARIF without rewriting its bytes', async () => {
    expect(await readCliReport(await fixture('{"results":[],"totalCount":0}'))).toEqual({ results: [], totalCount: 0 });
    const sarif = '{\n  "version": "2.1.0", "runs": []\n}\n';
    expect(await readCliReport(await fixture(sarif), undefined, 'sarif')).toBe(sarif);
  });

  it('rejects malformed reports, invalid SARIF, and canceled imports', async () => {
    await expect(readCliReport(await fixture('invalid'))).rejects.toThrow();
    await expect(readCliReport(await fixture('{"runs":[]}'), undefined, 'sarif')).rejects.toThrow('SARIF');
    await expect(readCliReport(await fixture('{}'), AbortSignal.abort())).rejects.toThrow();
  });
});
