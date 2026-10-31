import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CxCliClient, resultFromCli } from '../src/main/cxone/cli';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { normalizeFinding } from '../src/main/cxone/normalize';
import type { ScanJobState } from '../src/shared/types';
import { CLI_CAPABILITY_COMMANDS } from '../src/main/cliCapabilities';
import { resolveCli, runCliProcess } from '../src/main/cliProcess';

vi.mock('../src/main/cliProcess', async (original) => ({ ...await original<typeof import('../src/main/cliProcess')>(), resolveCli: vi.fn(async () => '/approved/cx'), runCliProcess: vi.fn() }));
const run = vi.mocked(runCliProcess);
const project = { ID: 'p1', Name: 'ui-project', MainBranch: 'main' };
const scan = { ID: 's1', ProjectID: 'p1', ProjectName: 'ui-project', Branch: 'main', Status: 'Queued' };
const client = () => new CxCliClient({ executable: '', configPath: '', authMode: 'cli' });
const job = (): ScanJobState => ({ id: 'j1', projectId: 'p1', projectName: 'ui-project', folderPath: '/projects/ui', branch: 'main', options: { ...DEFAULT_SETTINGS.defaults, excludes: [], tags: {}, branch: 'main' }, status: 'Unknown', progress: { phase: 'idle' }, startedAt: Date.now() });
beforeEach(() => {
  vi.restoreAllMocks();
  run.mockReset();
  vi.spyOn(CxCliClient.prototype, 'preflight').mockResolvedValue({ version: '2.3.69', commands: Object.fromEntries(CLI_CAPABILITY_COMMANDS.map((entry) => [entry.args.join(' ') || 'cx', new Set<string>([...entry.flags, 'base-branch', 'tags', 'file-filter-ext'])])) });
});

describe('Checkmarx CLI adapter', () => {
  it('imports complete reports beyond five thousand findings by default', async () => {
    run.mockImplementation(async ({ args }) => {
      const folder = args.find((arg) => arg.startsWith('--output-path='))!.slice('--output-path='.length);
      await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ scanID: 's1', totalCount: 6001, results: Array.from({ length: 6001 }, (_, index) => ({ id: String(index), type: 'sast' })) }));
      return '';
    });
    const result = await client().getAllResults('s1');
    expect(result.results).toHaveLength(6001);
    expect(result.truncated).toBe(false);
  });

  it('exports the official SARIF bytes and removes its private temporary report', async () => {
    let folder = '';
    const contents = '{\n"version":"2.1.0","runs":[]\n}\n';
    run.mockImplementation(async ({ args }) => {
      expect(args).toContain('--report-format=sarif');
      folder = args.find((arg) => arg.startsWith('--output-path='))!.slice('--output-path='.length);
      await fs.writeFile(path.join(folder, 'report.sarif'), contents);
      return '';
    });
    expect(await client().reportSarif('s1')).toBe(contents);
    await expect(fs.stat(folder)).rejects.toThrow();
  });

  it('blocks triage of unknown severity or an absent stable identity before any mutation', async () => {
    const finding = normalizeFinding({ id: 'f1', type: 'sast', similarityId: 'stable', severity: 'UNKNOWN' }, 's1', 'p1');
    await expect(client().triage({ finding, state: 'CONFIRMED', comment: 'reviewed' })).rejects.toThrow('severity is unknown');
    await expect(client().triage({ finding: { ...finding, severity: 'HIGH', similarityId: '' }, state: 'CONFIRMED', comment: 'reviewed' })).rejects.toThrow('stable similarity identity');
    expect(run).not.toHaveBeenCalled();
  });

  it('paginates history with explicit project and branch scope', async () => {
    run.mockResolvedValueOnce(JSON.stringify([scan]));
    const result = await client().listScans({ limit: 1, offset: 50, projectId: 'p1', branch: 'story' });
    expect(result.hasMore).toBe(true);
    const args = run.mock.calls[0][0].args;
    expect(args).toContain('--filter=limit=1,offset=50,sort=-created_at,project-id=p1,branch=story');
  });

  it('uses CLI configuration without requiring or writing credentials', async () => {
    run.mockResolvedValueOnce('Authenticated').mockResolvedValueOnce(JSON.stringify([project]));
    expect(await client().testConnection()).toMatchObject({ ok: true, cliVersion: '2.3.69', cliPath: '/approved/cx' });
    expect(run.mock.calls.map(([options]) => options.args.filter((arg) => !arg.startsWith('--')).slice(0, 2))).toEqual([['auth', 'validate'], ['project', 'list']]);
    expect(run.mock.calls[0][0].env?.CX_APIKEY).toBe(process.env.CX_APIKEY);
  });

  it('passes a Marx key only through the child environment and respects the config path', async () => {
    const original = process.env.CX_APIKEY;
    const cli = new CxCliClient({ executable: '/approved/cx', configPath: '/approved/config.yaml', authMode: 'marx', apiKey: 'synthetic-private-key', tenant: 'fixture', baseUrl: 'https://ast.example.test' });
    run.mockResolvedValue('[]');
    await cli.listProjects(1);
    const invocation = run.mock.calls[0][0];
    expect(invocation.env).toMatchObject({ CX_APIKEY: 'synthetic-private-key', CX_TENANT: 'fixture', CX_BASE_URI: 'https://ast.example.test' });
    expect(invocation.args).toContain('--config-file-path=/approved/config.yaml');
    expect(invocation.args.join(' ')).not.toContain('synthetic-private-key');
    expect(process.env.CX_APIKEY).toBe(original);
    expect(() => new CxCliClient({ executable: '', configPath: '', authMode: 'marx' })).toThrow('No Marx API key');
  });

  it('submits selected source through the CLI and returns structured identity', async () => {
    run.mockResolvedValueOnce(JSON.stringify([project])).mockResolvedValueOnce(JSON.stringify(scan));
    expect(await client().createScan(job())).toMatchObject({ id: 's1', projectId: 'p1', status: 'Queued' });
    expect(run.mock.calls[1][0].args).toContain('--file-source=/projects/ui');
    expect(run.mock.calls[1][0].timeoutMs).toBe(30 * 60_000);
    expect(run.mock.calls[1][0].args).toContain('--retry=0');
  });

  it('blocks mismatched or ambiguous projects before uploading', async () => {
    run.mockResolvedValueOnce(JSON.stringify([{ ...project, ID: 'another-project' }]));
    await expect(client().createScan(job())).rejects.toThrow('does not resolve uniquely');
    expect(run).toHaveBeenCalledOnce();
    run.mockClear().mockResolvedValueOnce(JSON.stringify([project, { ...project, ID: 'p2' }]));
    await expect(client().createScan(job())).rejects.toThrow('does not resolve uniquely');
    expect(run).toHaveBeenCalledOnce();
  });

  it('does not submit after cancellation during lookup or retry an uncertain submission', async () => {
    const controller = new AbortController();
    run.mockImplementationOnce(async () => { controller.abort(); return JSON.stringify([project]); });
    await expect(client().createScan(job(), controller.signal)).rejects.toThrow();
    expect(run).toHaveBeenCalledOnce();
    run.mockReset().mockResolvedValueOnce(JSON.stringify([project])).mockRejectedValueOnce(new Error('connection lost'));
    await expect(client().createScan(job())).rejects.toThrow('connection lost');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('rejects an existing name in new-project mode before submission', async () => {
    run.mockResolvedValueOnce(JSON.stringify([project]));
    await expect(client().createScan({ ...job(), projectId: undefined })).rejects.toThrow('already exists');
    expect(run).toHaveBeenCalledOnce();
  });

  it('stops an incompatible CLI before any authenticated invocation', async () => {
    vi.mocked(CxCliClient.prototype.preflight).mockRejectedValueOnce(new Error('Missing required capability. No upload was started.'));
    await expect(client().createScan(job())).rejects.toThrow('No upload');
    expect(run).not.toHaveBeenCalled();
  });

  it('scopes mappings to configuration bytes and never exposes credentials in the identity', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'marx-config-scope-'));
    try {
      const configPath = path.join(folder, 'config.yaml');
      await fs.writeFile(configPath, 'tenant: first\napikey: synthetic-secret\n');
      const cli = new CxCliClient({ executable: '/approved/cx', configPath, authMode: 'cli' });
      const first = await cli.connectionId();
      expect(first).toMatch(/^[a-f0-9]{64}$/);
      expect(await cli.connectionId()).toBe(first);
      await fs.writeFile(configPath, 'tenant: second\napikey: synthetic-secret\n');
      expect(await cli.connectionId()).not.toBe(first);
      await expect(cli.createScan({ ...job(), connectionId: first })).rejects.toThrow('configuration changed');
      expect(run).not.toHaveBeenCalled();
    } finally { await fs.rm(folder, { recursive: true, force: true }); }
  });

  it('checks configuration again after lookup and blocks a profile change before upload', async () => {
    const cli = client();
    vi.spyOn(cli, 'connectionId').mockResolvedValueOnce('first').mockResolvedValueOnce('changed');
    run.mockResolvedValueOnce(JSON.stringify([project]));
    await expect(cli.createScan({ ...job(), connectionId: 'first' })).rejects.toThrow('configuration changed');
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][0].args.slice(0, 2)).toEqual(['project', 'list']);
  });

  it('rejects scan metadata for a different ID', async () => {
    run.mockResolvedValueOnce(JSON.stringify({ ...scan, ID: 'wrong-scan' }));
    await expect(client().getScan('s1')).rejects.toThrow('different scan');
  });

  it('paginates projects and rejects overlapping pages', async () => {
    const projects = Array.from({ length: 100 }, (_, index) => ({ ID: `p${index}`, Name: `project${index}` }));
    run.mockResolvedValueOnce(JSON.stringify(projects)).mockResolvedValueOnce('[]');
    expect(await client().listProjects()).toMatchObject({ totalCount: 100, truncated: false });
    expect(run.mock.calls[1][0].args).toContain('--filter=limit=100,offset=100,sort=name');
    run.mockReset().mockResolvedValue(JSON.stringify(projects));
    await expect(client().listProjects()).rejects.toThrow('duplicate projects');
  });

  it('reads CLI report files, preserves true totals and removes temporary artifacts', async () => {
    let folder = '';
    run.mockImplementation(async ({ args }) => {
      folder = args.find((arg) => arg.startsWith('--output-path='))!.slice('--output-path='.length);
      await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ results: [{ id: 'one', type: 'sast' }, { id: 'two', type: 'sca' }], totalCount: 2 }));
      return 'Report created';
    });
    expect(await client().getAllResults('s1', 1)).toMatchObject({ totalCount: 2, truncated: true, results: [{ id: 'one' }] });
    await expect(fs.stat(folder)).rejects.toThrow();
  });

  it('does not treat missing or malformed reports as clean results', async () => {
    run.mockImplementation(async ({ args }) => {
      const folder = args.find((arg) => arg.startsWith('--output-path='))!.slice('--output-path='.length);
      await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ results: [] }));
      return '';
    });
    await expect(client().getAllResults('s1')).rejects.toThrow('unrecognized findings');
    expect(await client().getScanSummary('s1')).toBeNull();
  });

  it('routes history, polling and cancellation through the CLI', async () => {
    run.mockResolvedValueOnce(JSON.stringify([scan])).mockResolvedValueOnce(JSON.stringify({ ...scan, Status: 'Completed' })).mockResolvedValueOnce('Canceled');
    const cli = client();
    expect((await cli.listScans()).scans[0].id).toBe('s1');
    expect((await cli.getScan('s1')).status).toBe('Completed');
    await cli.cancelScan('s1');
    expect(run.mock.calls[2][0].args).toEqual(['scan', 'cancel', '--scan-id=s1', '--retry=0', '--debug=false']);
  });

  it('rejects a missing CLI without falling back to HTTP', async () => {
    vi.mocked(resolveCli).mockRejectedValueOnce(new Error('cx not found'));
    await expect(client().listProjects()).rejects.toThrow('cx not found');
    expect(run).not.toHaveBeenCalled();
  });
  it('preserves SCA package metadata and locations from official CLI report structures', () => {
    const identifier = 'Npm-@scope/example-package-1.2.3';
    const result = resultFromCli({ id: 'sca1', type: 'sca', severity: 'HIGH', data: { packageIdentifier: identifier, scaPackageData: { locations: ['package-lock.json'], dependencyPaths: [[{ id: identifier, name: '@scope/example-package', version: '1.2.3' }]] } } });
    expect(result.data?.packageIdentifier).toEqual({ name: '@scope/example-package', version: '1.2.3', packageManager: 'Npm' });
    expect(result.data?.scaPackageData?.locations).toEqual([{ path: 'package-lock.json' }]);
  });

  it('retains a submitted ID immediately from CLI output', async () => {
    run.mockResolvedValueOnce(JSON.stringify([project])).mockImplementationOnce(async ({ onLine }) => {
      onLine?.(JSON.stringify(scan));
      throw new Error('interrupted after submission');
    });
    const submitted = vi.fn();
    await expect(client().createScan(job(), undefined, { onSubmitted: submitted })).rejects.toThrow('interrupted after submission');
    expect(submitted).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', projectId: 'p1' }));
  });

  it('maps summary report counts and removes reports after failure', async () => {
    run.mockImplementation(async ({ args }) => {
      const folder = args.find((arg) => arg.startsWith('--output-path='))!.slice('--output-path='.length);
      await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify({ CriticalIssues: 0, HighIssues: 3, MediumIssues: 0, LowIssues: 2, InfoIssues: 0 }));
      return '';
    });
    expect(await client().getScanSummary('s1')).toEqual({ critical: 0, high: 3, medium: 0, low: 2, info: 0 });
    const folder = run.mock.calls[0][0].args.find((arg) => arg.startsWith('--output-path='))!.slice('--output-path='.length);
    await expect(fs.stat(folder)).rejects.toThrow();
  });

  it('compares returned project identity with the original selection even after streaming updates', async () => {
    const target = job();
    const unexpected = { ...scan, ProjectID: 'wrong-project' };
    run.mockResolvedValueOnce(JSON.stringify([project])).mockImplementationOnce(async ({ onLine }) => {
      onLine?.(JSON.stringify(unexpected));
      return JSON.stringify(unexpected);
    });
    await expect(client().createScan(target, undefined, { onSubmitted: (submitted) => { target.projectId = submitted.projectId; } })).rejects.toThrow('unexpected project');
    expect(run.mock.calls[2][0].args).toContain('--scan-id=s1');
    expect(run.mock.calls[2][0].args.slice(0, 2)).toEqual(['scan', 'cancel']);
  });

  it('uses the CLI triage contract for SAST and SCA findings', async () => {
    run.mockResolvedValue('Predicate updated successfully');
    const finding = normalizeFinding({ id: 'r1', type: 'sast', severity: 'HIGH', similarityId: '42' }, 's1', 'p1');
    await client().triage({ finding, state: 'CONFIRMED', comment: 'Reviewed' });
    expect(run.mock.calls[0][0].args).toEqual(expect.arrayContaining(['triage', 'update', '--project-id=p1', '--scan-type=sast', '--similarity-id=42', '--state=CONFIRMED', '--severity=HIGH', '--comment=Reviewed', '--retry=0']));
    const sca = { ...finding, type: 'sca', packageName: 'lodash', packageVersion: '4.17.20', packageManager: 'Npm', cve: 'CVE-2021-23337' };
    await client().triage({ finding: sca, state: 'NOT_EXPLOITABLE', comment: 'Reviewed' });
    expect(run.mock.calls[1][0].args).toContain('--vulnerability-identifiers=packageName=lodash,packageVersion=4.17.20,packageManager=Npm,vulnerabilityId=CVE-2021-23337');
    await expect(client().triage({ finding: { ...sca, packageVersion: undefined }, state: 'CONFIRMED', comment: 'Reviewed' })).rejects.toThrow('requires package name');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('accepts the CLI null results slice only with an explicit zero total', async () => {
    let report: unknown = { scanID: 's1', results: null, totalCount: 0 };
    run.mockImplementation(async ({ args }) => {
      const folder = args.find((arg) => arg.startsWith('--output-path='))!.slice('--output-path='.length);
      await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify(report));
      return '';
    });
    expect(await client().getAllResults('s1')).toEqual({ results: [], totalCount: 0, truncated: false });
    report = { results: null, totalCount: 2 };
    await expect(client().getAllResults('s1')).rejects.toThrow('unrecognized findings');
    report = { scanID: 'another-scan', results: [], totalCount: 0 };
    await expect(client().getAllResults('s1')).rejects.toThrow('different scan');
  });

});
