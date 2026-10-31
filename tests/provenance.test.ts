import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureProvenance, fingerprintScanOptions } from '../src/main/provenance';
import { DEFAULT_SETTINGS, type ScanOptions } from '../src/shared/types';

const folders: string[] = [];
const options: ScanOptions = { ...DEFAULT_SETTINGS.defaults, branch: 'main', excludes: [], tags: {} };
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => fs.rm(folder, { recursive: true, force: true }))); });

describe('source and scan provenance', () => {
  it('fingerprints analysis options independently of branch and descriptive tags', () => {
    expect(fingerprintScanOptions(options)).toBe(fingerprintScanOptions({ ...options, branch: 'fix/security', tags: { story: 'repair' }, scanners: ['sca', 'sast'] }));
    expect(fingerprintScanOptions(options)).not.toBe(fingerprintScanOptions({ ...options, excludes: ['src/critical'] }));
    expect(fingerprintScanOptions(options)).not.toBe(fingerprintScanOptions({ ...options, sastPreset: 'Different' }));
  });

  it('includes untracked working files without claiming an immutable scan archive', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'marx-provenance-'));
    folders.push(folder);
    execFileSync('git', ['init', '--initial-branch=story', folder], { stdio: 'ignore' });
    await fs.writeFile(path.join(folder, 'example.ts'), 'export const value = 1;');
    const first = await captureProvenance(folder, options, 'c1', 'fixture');
    await fs.writeFile(path.join(folder, 'example.ts'), 'export const value = 2;');
    const second = await captureProvenance(folder, options, 'c1', 'fixture');
    expect(first.source).toMatchObject({ branch: 'story', dirty: true, snapshot: false, capturedFiles: 1, fingerprintScope: 'git-visible-files' });
    expect(first.source.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.source.fingerprint).not.toBe(first.source.fingerprint);
    expect(first.completedScanners).toBeUndefined();
    expect(first.effectiveConfigFingerprint).toBeUndefined();
  });

  it('makes oversized-file uncertainty explicit instead of returning a misleading fingerprint', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'marx-large-source-'));
    folders.push(folder);
    const file = await fs.open(path.join(folder, 'oversized.bin'), 'w');
    await file.truncate(17 * 1024 * 1024);
    await file.close();
    const provenance = await captureProvenance(folder, options, 'c1');
    expect(provenance.source.fingerprint).toBeUndefined();
    expect(provenance.source.captureWarning).toContain('limit');
  });
});
