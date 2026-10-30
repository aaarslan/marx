import { describe, expect, it } from 'vitest';
import { buildScanRequest } from '../src/main/scanRunner';
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

describe('buildScanRequest', () => {
  it('includes both scanners with their config', () => {
    const req = buildScanRequest(job(), 'https://s3/u');
    expect(req.type).toBe('upload');
    expect(req.handler).toEqual({ branch: 'develop', uploadUrl: 'https://s3/u' });
    expect(req.project).toEqual({ id: 'p1' });
    expect(req.tags).toEqual({ team: 'frontend' });
    expect(req.config).toEqual([
      {
        type: 'sast',
        value: { presetName: 'Checkmarx Default', incremental: 'true', baseBranch: 'main' }
      },
      { type: 'sca', value: {} }
    ]);
  });

  it('omits scanners that are not selected', () => {
    const req = buildScanRequest(job({ scanners: ['sca'], scaExploitablePath: true }), 'https://s3/u');
    expect(req.config).toEqual([{ type: 'sca', value: { ExploitablePath: 'true' } }]);
  });

  it('full scan when incremental is off', () => {
    const req = buildScanRequest(job({ scanners: ['sast'], sastIncremental: false }), 'https://s3/u');
    expect(req.config[0].value).toEqual({ presetName: 'Checkmarx Default', incremental: 'false' });
  });

  it('drops tags when empty', () => {
    const req = buildScanRequest(job({ tags: {} }), 'https://s3/u');
    expect(req.tags).toBeUndefined();
  });
});
