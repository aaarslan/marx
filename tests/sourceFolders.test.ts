import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceFolders } from '../src/main/sourceFolders';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((folder) => fs.rm(folder, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'marx-grants-'));
  temporary.push(root);
  return root;
}

describe('source folder access', () => {
  it('requires an explicit grant and rejects files', async () => {
    const root = await fixture();
    const access = new SourceFolders();
    await expect(access.require(root)).rejects.toThrow('Choose this folder');
    const canonical = await access.grant(root);
    expect(await access.require(root)).toBe(canonical);
    const file = path.join(root, 'source.ts');
    await fs.writeFile(file, 'source');
    await expect(access.grant(file)).rejects.toThrow('not a file');
    await expect(access.require(file)).rejects.toThrow();
  });

  it('canonicalizes selected roots without granting sibling folders', async () => {
    const root = await fixture();
    const allowed = path.join(root, 'allowed');
    const sibling = path.join(root, 'sibling');
    await fs.mkdir(allowed);
    await fs.mkdir(sibling);
    await fs.symlink(allowed, path.join(root, 'alias'));
    const access = new SourceFolders([allowed, path.join(root, 'missing')]);
    expect(await access.require(path.join(root, 'alias'))).toBe(await fs.realpath(allowed));
    await expect(access.require(sibling)).rejects.toThrow();
  });
});
