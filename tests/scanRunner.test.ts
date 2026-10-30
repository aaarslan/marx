import { describe, expect, it } from 'vitest';
import { buildScanArgs } from '../src/main/cxone/cli';
import type { ScanJobState, ScanOptions } from '../src/shared/types';

function job(overrides: Partial<ScanOptions> = {}): ScanJobState {
  const options: ScanOptions = {
    scanners: ['sast', 'sca'],
    branch: 'develop',
    sastPreset: 'Checkmarx Default',
    sastIncremental: true,
    sastBaseBranch: 'main',
    scaExploitablePath: false,
    excludes: [],
    tags: { team: 'frontend' },
    ...overrides
  };
  return {
    id: 'j1',
    folderPath: '/tmp/x',
    projectName: 'x',
    projectId: 'p1',
    branch: options.branch,
    options,
    progress: { phase: 'idle' },
    status: 'Unknown',
    startedAt: 0
  };
}

describe('CLI scan arguments', () => {
  it('maps source and options without a shell or secrets in argv', () => {
    const args = buildScanArgs(job());
    expect(args).toContain('--file-source=/tmp/x');
    expect(args).toContain('--project-name=x');
    expect(args).toContain('--branch=develop');
    expect(args).toContain('--scan-types=sast,sca');
    expect(args).toContain('--sast-preset-name=Checkmarx Default');
    expect(args).toContain('--sast-incremental=true');
    expect(args).toContain('--base-branch=main');
    expect(args).toContain('--tags=team:frontend');
    expect(args).toContain('--async');
    expect(args).toContain('--scan-info-format=json');
    expect(args).toContain('--retry=0');
    expect(args).toContain('--exclude-git-folder');
    expect(args.join(' ')).not.toContain('apikey');
  });

  it('omits options belonging to disabled scanners', () => {
    const args = buildScanArgs(job({ scanners: ['sca'], scaExploitablePath: true }));
    expect(args).toContain('--scan-types=sca');
    expect(args).toContain('--sca-exploitable-path=true');
    expect(args.some((arg) => arg.startsWith('--sast-'))).toBe(false);
    expect(args.some((arg) => arg.startsWith('--base-branch='))).toBe(false);
  });

  it('preserves default removals and explicit full scans', () => {
    const args = buildScanArgs(job({ sastIncremental: false, excludes: ['!node_modules', 'fixtures', '!.git'] }));
    const filter = args.find((arg) => arg.startsWith('--file-filter='))!;
    expect(filter).not.toContain('!node_modules');
    expect(filter).toContain('!fixtures');
    expect(args).not.toContain('--exclude-git-folder');
    expect(args).toContain('--sast-incremental=false');
    expect(args.some((arg) => arg.startsWith('--base-branch='))).toBe(false);
  });

  it('keeps flag-like values and shell metacharacters as literal argument values', () => {
    const target = job();
    target.projectName = '--debug; $(touch /tmp/never)';
    target.folderPath = '/tmp/project with spaces';
    expect(buildScanArgs(target)).toContain('--project-name=--debug; $(touch /tmp/never)');
    expect(buildScanArgs(target)).toContain('--file-source=/tmp/project with spaces');
    expect(() => buildScanArgs(job({ scanners: [] }))).toThrow('at least one');
    expect(() => buildScanArgs(job({ excludes: ['foo,bar'] }))).toThrow('commas');
    expect(() => buildScanArgs(job({ tags: { endpoint: 'https://example.test' } }))).toThrow('cannot preserve');
  });
  it('uses path filters for path-based exclusions', () => {
    const args = buildScanArgs(job({ excludes: ['fixtures/private/**', 'src/secret.json'] }));
    expect(args.find((arg) => arg.startsWith('--file-filter-ext='))).toContain('!fixtures/private/**');
    expect(args.find((arg) => arg.startsWith('--file-filter-ext='))).toContain('!src/secret.json');
    expect(args.find((arg) => arg.startsWith('--file-filter='))).not.toContain('fixtures/private');
  });

});
