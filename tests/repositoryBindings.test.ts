import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RepositoryBindings } from '../src/main/repositoryBindings';

const temporary: string[] = [];
afterEach(() => { for (const folder of temporary.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
const create = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-bindings-'));
  temporary.push(folder);
  const file = path.join(folder, 'bindings.json');
  return { file, store: new RepositoryBindings(file) };
};

describe('explicit repository mappings', () => {
  it('separates identical folder names and configuration identities across restart', () => {
    const { store, file } = create();
    store.save({ folderPath: '/first/ui', projectId: 'p1', projectName: 'First', connectionId: 'tenant-a' });
    store.save({ folderPath: '/second/ui', projectId: 'p2', projectName: 'Second', connectionId: 'tenant-a' });
    const reloaded = new RepositoryBindings(file);
    expect(reloaded.get('/first/ui', 'tenant-a')?.projectId).toBe('p1');
    expect(reloaded.get('/second/ui', 'tenant-a')?.projectId).toBe('p2');
    expect(reloaded.get('/first/ui', 'tenant-b')).toBeNull();
    expect(reloaded.get('/unmapped/ui', 'tenant-a')).toBeNull();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('replaces only the selected folder mapping within its connection', () => {
    const { store } = create();
    store.save({ folderPath: '/first/ui', projectId: 'p1', projectName: 'First', connectionId: 'a' });
    store.save({ folderPath: '/first/ui', projectId: 'p2', projectName: 'Second', connectionId: 'b' });
    store.save({ folderPath: '/first/ui', projectId: 'p3', projectName: 'Third', connectionId: 'a' });
    expect(store.get('/first/ui', 'a')?.projectId).toBe('p3');
    expect(store.get('/first/ui', 'b')?.projectId).toBe('p2');
  });

  it('blocks corrupted state rather than forgetting identity silently', () => {
    const { store, file } = create();
    fs.writeFileSync(file, '[{}]');
    expect(() => store.get('/first/ui', 'a')).toThrow('invalid');
    expect(fs.readFileSync(file, 'utf8')).toBe('[{}]');
  });
});
