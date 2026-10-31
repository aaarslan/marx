import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar') as typeof import('@electron/asar');
const directoryCompare = require('dir-compare') as typeof import('dir-compare');
type MergeModule = typeof import('@electron/universal/dist/cjs/asar-utils');
const folders: string[] = [];

function fixture(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'marx-packaging-consumers-'));
  folders.push(folder);
  return folder;
}

function writeTree(folder: string, files: Record<string, string | Buffer>): void {
  mkdirSync(folder, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    const destination = path.join(folder, filename);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
}

async function createArchive(root: string, name: string, files: Record<string, string | Buffer>, unpack?: string): Promise<string> {
  const source = path.join(root, name);
  const archive = path.join(root, `${name}.asar`);
  writeTree(source, files);
  await asar.createPackageWithOptions(source, archive, { unpack });
  return archive;
}

afterEach(() => {
  asar.uncacheAll();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const runtimes = [
  { name: 'CommonJS', enabled: process.platform !== 'win32', load: async () => require('@electron/universal/dist/cjs/asar-utils') as MergeModule },
  { name: 'ESM under Bun', enabled: process.platform !== 'win32' && Boolean(process.versions.bun), load: async () => import(pathToFileURL(require.resolve('@electron/universal/dist/esm/asar-utils.js')).href) as Promise<MergeModule> },
];

for (const runtime of runtimes) {
  describe.runIf(runtime.enabled)(`universal archive allowlists (macOS-only package; skipped on Windows): ${runtime.name}`, () => {
    it.each(['*.bin', 'nested/*.bin'])('retains nested architecture files and unpacked bytes allowed by %s', async singleArchFiles => {
      const root = fixture();
      const shared = { 'nested/common.txt': 'same content in both architectures' };
      const x64Bytes = Buffer.from([0, 1, 2, 255]);
      const arm64Bytes = Buffer.from([3, 0, 4, 254]);
      const x64Name = 'nested/native (x64),{one}.bin';
      const arm64Name = 'nested/native [arm64].bin';
      const x64AsarPath = await createArchive(root, 'x64', { ...shared, [x64Name]: x64Bytes }, '*.bin');
      const arm64AsarPath = await createArchive(root, 'arm64', { ...shared, [arm64Name]: arm64Bytes }, '*.bin');
      const outputAsarPath = path.join(root, 'merged.asar');
      const { mergeASARs } = await runtime.load();

      await mergeASARs({ x64AsarPath, arm64AsarPath, outputAsarPath, singleArchFiles });

      expect(asar.listPackage(outputAsarPath, { isPack: false }).map(entry => entry.replace(/\\/g, '/')).sort()).toEqual(['/nested', '/nested/common.txt', `/${x64Name}`, `/${arm64Name}`].sort());
      expect(asar.extractFile(outputAsarPath, x64Name)).toEqual(x64Bytes);
      expect(asar.extractFile(outputAsarPath, arm64Name)).toEqual(arm64Bytes);
      expect(asar.statFile(outputAsarPath, x64Name)).toMatchObject({ unpacked: true });
      expect(asar.statFile(outputAsarPath, arm64Name)).toMatchObject({ unpacked: true });
    });

    it('rejects a same-basename architecture file outside the allowed directory', async () => {
      const root = fixture();
      const shared = { 'nested/common.txt': 'same', 'unapproved/common.txt': 'same' };
      const x64AsarPath = await createArchive(root, 'x64', { ...shared, 'unapproved/only.bin': 'unique bytes' });
      const arm64AsarPath = await createArchive(root, 'arm64', shared);
      const { mergeASARs } = await runtime.load();

      await expect(mergeASARs({ x64AsarPath, arm64AsarPath, outputAsarPath: path.join(root, 'rejected.asar'), singleArchFiles: 'nested/*.bin' }))
        .rejects.toThrow(/unique file "unapproved[\\/]only\.bin".*not covered by/);
    });

    it('requires an explicit allowlist for unexpected architecture-specific files', async () => {
      const root = fixture();
      const shared = { 'nested/common.txt': 'same' };
      const x64AsarPath = await createArchive(root, 'x64', { ...shared, 'nested/only.bin': 'unique bytes' });
      const arm64AsarPath = await createArchive(root, 'arm64', shared);
      const { mergeASARs } = await runtime.load();

      await expect(mergeASARs({ x64AsarPath, arm64AsarPath, outputAsarPath: path.join(root, 'rejected.asar') }))
        .rejects.toThrow(/unique file "nested[\\/]only\.bin".*not covered by/);
    });

    it('keeps an encoded-lookalike filename packed when exactly one literal filename is unpacked', async () => {
      const root = fixture();
      const literal = 'nested/native (arm).bin';
      const lookalike = 'nested/native [(]arm[)].bin';
      const shared = { [literal]: 'unpacked native bytes', [lookalike]: 'packed lookalike bytes' };
      const x64AsarPath = await createArchive(root, 'x64', shared, '**/native [(]arm[)].bin');
      const arm64AsarPath = await createArchive(root, 'arm64', shared, '**/native [(]arm[)].bin');
      expect(asar.statFile(x64AsarPath, literal)).toMatchObject({ unpacked: true });
      expect(asar.statFile(x64AsarPath, lookalike)).not.toMatchObject({ unpacked: true });
      const outputAsarPath = path.join(root, 'merged.asar');
      const { mergeASARs } = await runtime.load();

      await mergeASARs({ x64AsarPath, arm64AsarPath, outputAsarPath });

      expect(asar.statFile(outputAsarPath, literal)).toMatchObject({ unpacked: true });
      expect(asar.statFile(outputAsarPath, lookalike)).not.toMatchObject({ unpacked: true });
      expect(asar.extractFile(outputAsarPath, literal).toString()).toBe(shared[literal]);
      expect(asar.extractFile(outputAsarPath, lookalike).toString()).toBe(shared[lookalike]);
    });
  });
}

function comparedFiles(result: import('dir-compare').Result): string[] {
  return (result.diffSet ?? [])
    .filter(entry => entry.type1 === 'file' || entry.type2 === 'file')
    .map(entry => path.posix.join(entry.relativePath.replace(/\\/g, '/'), entry.name1 ?? entry.name2 ?? '').replace(/^\//, ''))
    .sort();
}

describe('directory comparison filters', () => {
  it('applies include patterns to files while preserving traversal through unmatched directory names', async () => {
    const root = fixture();
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');
    writeTree(left, { 'plain.txt': 'before', 'folder.txt/kept.js': 'before', '.hidden.js': 'before', 'nested/equal.js': 'same' });
    writeTree(right, { 'plain.txt': 'after', 'folder.txt/kept.js': 'after', '.hidden.js': 'after', 'nested/equal.js': 'same' });

    const result = await directoryCompare.compare(left, right, { compareContent: true, includeFilter: '*.js' });

    expect(result.same).toBe(false);
    expect(comparedFiles(result)).toEqual(['.hidden.js', 'folder.txt/kept.js', 'nested/equal.js']);
  });

  it('matches slash-containing filters against the relative path rather than only the basename', () => {
    const root = fixture();
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');
    writeTree(left, { 'src/match.js': 'same', 'src/deeper/skip.js': 'before', 'other/match.js': 'before' });
    writeTree(right, { 'src/match.js': 'same', 'src/deeper/skip.js': 'after', 'other/match.js': 'after' });

    const result = directoryCompare.compareSync(left, right, { compareContent: true, includeFilter: '/src/*.js' });

    expect(result.same).toBe(true);
    expect(comparedFiles(result)).toEqual(['src/match.js']);
  });

  it('excludes matching files and entire matching directories', () => {
    const root = fixture();
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');
    writeTree(left, { 'excluded-directory/deep/file.js': 'before', 'excluded.txt': 'before', 'kept/deep.js': 'same' });
    writeTree(right, { 'excluded-directory/deep/file.js': 'after', 'excluded.txt': 'after', 'kept/deep.js': 'same' });

    const result = directoryCompare.compareSync(left, right, { compareContent: true, excludeFilter: 'excluded-directory,excluded.txt' });

    expect(result.same).toBe(true);
    expect(comparedFiles(result)).toEqual(['kept/deep.js']);
    expect(result.diffSet?.some(entry => (entry.name1 ?? entry.name2 ?? '').startsWith('excluded'))).toBe(false);
  });
});
