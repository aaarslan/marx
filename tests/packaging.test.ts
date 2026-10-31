import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const verification = createRequire(import.meta.url)('../scripts/verify-packaging.cjs') as {
  verifyDependencies(): { patchedVersions: Record<string, string>; resolved: { consumer: string; slot: string; name: string; version: string }[]; installedPackages: number };
  verifyFileMatchers(): { pathImplementations: { platform: string; root: string; assertions: number }[]; assertions: number };
  verifyAsar(): Promise<{ files: number; entries: number; archives: string[]; symlinks: boolean; windowsLinkAssertions: number; skipped: string[] }>;
};

describe('packaging dependency replacement', () => {
  it('uses real replacement packages in every legacy dependency slot and commits patches for the reviewed versions', () => {
    const result = verification.verifyDependencies();
    expect(Object.keys(result.patchedVersions)).toHaveLength(4);
    expect(result.resolved.filter(item => item.slot === 'minimatch')).toHaveLength(4);
    expect(result.resolved.filter(item => item.slot === 'glob')).toEqual([{ consumer: '@electron/asar', slot: 'glob', name: 'fdir', version: '6.5.0' }]);
    expect(result.installedPackages).toBeGreaterThan(0);
  });

  it('preserves ordered inclusion, exclusions and traversable parent paths for POSIX, Windows drives and UNC roots', () => {
    const result = verification.verifyFileMatchers();
    expect(result.pathImplementations.map(item => item.platform)).toEqual(['linux', 'darwin', 'win32', 'win32']);
    expect(result.assertions).toBe(148);
  });

  it('preserves ASAR bytes, dotfiles, empty directories, unpacking and safe symlinks through public archive APIs', async () => {
    const result = await verification.verifyAsar();
    expect(result.files).toBe(12);
    expect(result.archives).toEqual(['default', 'unpacked', 'filtered', 'streams']);
    expect(result.windowsLinkAssertions).toBe(5);
    if (process.platform !== 'win32') {
      expect(result.symlinks).toBe(true);
      expect(result.skipped).toEqual([]);
    }
  });
});
