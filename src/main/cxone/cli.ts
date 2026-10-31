import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { ScanJobState, Settings, TestConnectionResult, TriageRequest } from '@shared/types';
import { DEFAULT_EXCLUDES, RESULT_STATES } from '@shared/types';
import type { CxProject, CxResult, CxScan, CxScanSummary } from './types';
import { inspectCliCapabilities, requireScanCapabilities } from '../cliCapabilities';
import { parseCliJson, resolveCli, runCliProcess } from '../cliProcess';
import { readCliReport } from '../reportReader';

export interface CliConfig {
  executable: string;
  configPath: string;
  authMode: Settings['cliAuthMode'];
  apiKey?: string | null;
  baseUrl?: string;
  tenant?: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected Checkmarx CLI JSON structure.');
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`The CLI response has no ${name}.`);
  return value;
}

export function scanFromCli(value: unknown): CxScan {
  const item = record(value);
  return {
    id: requiredString(item.ID ?? item.id, 'scan ID'),
    status: requiredString(item.Status ?? item.status, 'scan status'),
    projectId: requiredString(item.ProjectID ?? item.projectId, 'project ID'),
    projectName: String(item.ProjectName ?? item.projectName ?? ''),
    branch: String(item.Branch ?? item.branch ?? ''),
    createdAt: String(item.CreatedAt ?? item.createdAt ?? ''),
    updatedAt: String(item.UpdatedAt ?? item.updatedAt ?? ''),
    sourceOrigin: String(item.Origin ?? item.sourceOrigin ?? ''),
    tags: (item.Tags ?? item.tags ?? {}) as Record<string, string>
  };
}

function projectFromCli(value: unknown): CxProject {
  const item = record(value);
  return {
    id: requiredString(item.ID ?? item.id, 'project ID'),
    name: requiredString(item.Name ?? item.name, 'project name'),
    mainBranch: String(item.MainBranch ?? item.mainBranch ?? 'main'),
    tags: (item.Tags ?? item.tags ?? {}) as Record<string, string>
  };
}

export function resultFromCli(value: unknown): CxResult {
  const item = record(value);
  requiredString(item.id, 'finding ID');
  requiredString(item.type, 'finding type');
  if (item.type !== 'sca') return item as unknown as CxResult;
  const data = record(item.data ?? {});
  const pkg = record(data.scaPackageData ?? {});
  const identifier = data.packageIdentifier;
  let packageInfo: Record<string, unknown> = typeof identifier === 'object' && identifier !== null ? record(identifier) : {};
  if (typeof identifier === 'string') {
    const paths = Array.isArray(pkg.dependencyPaths) ? pkg.dependencyPaths.flat().filter((entry) => entry && typeof entry === 'object') as Record<string, unknown>[] : [];
    const exact = paths.find((entry) => entry.id === identifier);
    packageInfo = { name: exact?.name ?? identifier, version: exact?.version, packageManager: identifier.match(/^([A-Za-z]+)-/)?.[1] };
  }
  const locations = Array.isArray(pkg.locations) ? pkg.locations.map((location) => typeof location === 'string' ? { path: location } : location) : [];
  return { ...item, data: { ...data, packageIdentifier: packageInfo, scaPackageData: { ...pkg, locations }, recommendedVersion: typeof data.recommendedVersion === 'string' ? data.recommendedVersion : undefined } } as unknown as CxResult;
}

export function buildScanArgs(job: ScanJobState): string[] {
  if (!job.projectName.trim() || !job.branch.trim() || !job.options.scanners.length || job.options.scanners.some((scanner) => !['sast', 'sca'].includes(scanner))) {
    throw new Error('Select a project, branch and at least one supported scanner.');
  }
  const excludes = new Set(DEFAULT_EXCLUDES);
  for (const pattern of job.options.excludes) {
    const value = pattern.trim();
    if (!value) continue;
    if (value.startsWith('!')) excludes.delete(value.slice(1));
    else excludes.add(value);
  }
  if ([...excludes].some((pattern) => /[,\r\n]/.test(pattern))) throw new Error('Exclude patterns cannot contain commas or newlines.');
  const args = ['scan', 'create', `--file-source=${job.folderPath}`, `--project-name=${job.projectName}`,
    `--branch=${job.branch}`, `--scan-types=${job.options.scanners.join(',')}`, '--async', '--scan-info-format=json',
    '--skip-default-filter', `--file-filter=${[...excludes].filter((entry) => !entry.includes('/')).map((entry) => `!${entry}`).join(',')}`, '--retry=0'];
  const pathExcludes = [...excludes].filter((entry) => entry.includes('/'));
  if (pathExcludes.length) args.push(`--file-filter-ext=${pathExcludes.flatMap((entry) => [`!${entry}`, `!${entry.replace(/\/$/, '')}/**`]).join(',')}`);
  if (excludes.has('.git')) args.push('--exclude-git-folder');
  if (job.options.scanners.includes('sast')) {
    args.push(`--sast-incremental=${job.options.sastIncremental}`);
    if (job.options.sastPreset) args.push(`--sast-preset-name=${job.options.sastPreset}`);
    if (job.options.sastIncremental && job.options.sastBaseBranch) args.push(`--base-branch=${job.options.sastBaseBranch}`);
  }
  if (job.options.scanners.includes('sca')) args.push(`--sca-exploitable-path=${job.options.scaExploitablePath}`);
  const tags = Object.entries(job.options.tags);
  if (tags.some(([key, value]) => /[:,\r\n]/.test(key) || /[:,\r\n]/.test(value))) throw new Error('The CLI cannot preserve colons, commas or newlines inside tag names or values.');
  if (tags.length) args.push(`--tags=${tags.map(([key, value]) => `${key}:${value}`).join(',')}`);
  return args;
}

export class CxCliClient {
  private executable: Promise<string>;
  private env: NodeJS.ProcessEnv;

  constructor(private readonly config: CliConfig) {
    if (config.configPath && !path.isAbsolute(config.configPath)) throw new Error('The CLI configuration file path must be absolute.');
    this.executable = resolveCli(config.executable);
    this.executable.catch(() => undefined);
    this.env = { ...process.env };
    if (config.authMode === 'marx') {
      if (!config.apiKey) throw new Error('No Marx API key configured. Save a key in Settings or choose the CLI’s existing configuration.');
      this.env.CX_APIKEY = config.apiKey;
      delete this.env.CX_CLIENT_ID;
      delete this.env.CX_CLIENT_SECRET;
      if (config.baseUrl) this.env.CX_BASE_URI = config.baseUrl;
      if (config.tenant) this.env.CX_TENANT = config.tenant;
    }
  }

  async connectionId(): Promise<string> {
    const configPath = this.config.configPath || this.env.CX_CONFIG_FILE_PATH || path.join(this.env.HOME || os.homedir(), '.checkmarx', 'checkmarxcli.yaml');
    let config = Buffer.alloc(0);
    try {
      const handle = await fs.open(configPath, 'r');
      try {
        if ((await handle.stat()).size > 1024 * 1024) throw new Error('CLI configuration exceeds 1 MiB.');
        config = await handle.readFile();
      } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || this.config.configPath) throw error;
    }
    const context = JSON.stringify([await this.executable, path.resolve(configPath), this.config.authMode,
      Object.entries(this.env).filter(([key]) => key.startsWith('CX_')).sort(([a], [b]) => a.localeCompare(b))]);
    return createHash('sha256').update(context).update(config).digest('hex');
  }

  private async command(args: string[], options: { signal?: AbortSignal; onLine?: (line: string) => void; timeoutMs?: number; cwd?: string } = {}): Promise<string> {
    return runCliProcess({
      executable: await this.executable,
      args: [...args, '--debug=false', ...(this.config.configPath ? [`--config-file-path=${this.config.configPath}`] : [])],
      env: this.env, ...options
    });
  }

  private async json(args: string[], signal?: AbortSignal): Promise<unknown> {
    return parseCliJson(await this.command(args, { signal }));
  }

  async preflight(signal?: AbortSignal) {
    return inspectCliCapabilities(await this.executable, this.env, runCliProcess, signal);
  }

  async getVersion(signal?: AbortSignal): Promise<string> {
    return (await this.command(['version'], { signal, timeoutMs: 10_000 })).trim().slice(0, 120) || 'unknown';
  }

  async getProject(projectId: string, signal?: AbortSignal): Promise<CxProject> {
    const project = projectFromCli(await this.json(['project', 'show', `--project-id=${projectId}`, '--format=json'], signal));
    if (project.id !== projectId) throw new Error('The CLI returned a different project. Refresh the project list.');
    return project;
  }

  async testConnection(): Promise<TestConnectionResult> {
    const { version } = await this.preflight();
    await this.command(['auth', 'validate']);
    await this.listProjects(1);
    return { ok: true, message: `Checkmarx CLI ${version}: required CLI capabilities, authentication and project access verified.`, cliPath: await this.executable, cliVersion: version };
  }

  async listProjects(limit = 1000, signal?: AbortSignal): Promise<{ projects: CxProject[]; totalCount: number; truncated: boolean }> {
    const projects: CxProject[] = [];
    const ids = new Set<string>();
    for (let offset = 0; offset < limit;) {
      const size = Math.min(100, limit - offset);
      const data = await this.json(['project', 'list', '--format=json', `--filter=limit=${size},offset=${offset},sort=name`], signal);
      if (!Array.isArray(data) || data.length > size) throw new Error('The CLI returned an invalid project list.');
      const batch = data.map(projectFromCli);
      for (const project of batch) {
        if (ids.has(project.id)) throw new Error('The CLI returned duplicate projects. Refresh the project list.');
        ids.add(project.id);
      }
      projects.push(...batch);
      offset += size;
      if (batch.length < size) return { projects, totalCount: projects.length, truncated: false };
    }
    return { projects, totalCount: projects.length, truncated: true };
  }

  async createScan(job: ScanJobState, signal?: AbortSignal, events: { onLine?: (line: string) => void; onSubmitted?: (scan: CxScan) => void; onStarting?: () => void } = {}): Promise<CxScan> {
    const args = buildScanArgs(job);
    const capabilities = await this.preflight(signal);
    requireScanCapabilities(capabilities, args);
    if (job.connectionId && job.connectionId !== await this.connectionId()) throw new Error('CLI configuration changed. Review the repository mapping before scanning. No upload was started.');
    const expectedProjectId = job.projectId;
    const matches = await this.json(['project', 'list', '--format=json', `--filter=${csvValue(`name=${job.projectName}`)},limit=1000`], signal);
    if (!Array.isArray(matches) || matches.length >= 1000) throw new Error('The project lookup is incomplete. Use a unique project name.');
    const exact = matches.map(projectFromCli).filter((project) => project.name === job.projectName);
    if (exact.length > 1 || (job.projectId && (exact.length !== 1 || exact[0].id !== job.projectId))) {
      throw new Error('The selected project does not resolve uniquely by name in the CLI. Refresh projects and select it again.');
    }
    if (!expectedProjectId && exact.length) throw new Error('A project with this name already exists. Select and bind that existing project explicitly before scanning.');
    signal?.throwIfAborted();
    if (job.connectionId && job.connectionId !== await this.connectionId()) throw new Error('CLI configuration changed. Review the repository mapping before scanning. No upload was started.');
    events.onStarting?.();
    const output = await this.command(args, { signal, onLine: (line) => {
      if (line.startsWith('{')) {
        try { events.onSubmitted?.(scanFromCli(parseCliJson(line))); } catch {}
      }
      events.onLine?.(line);
    }, timeoutMs: 30 * 60_000, cwd: os.homedir() });
    const scan = scanFromCli(parseCliJson(output));
    if (expectedProjectId && scan.projectId !== expectedProjectId) {
      try {
        await this.cancelScan(scan.id);
      } catch (error) {
        throw new Error(`CLI created scan ${scan.id} in an unexpected project; remote cancellation is unconfirmed: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw new Error(`CLI created scan ${scan.id} in an unexpected project; cancellation was requested. Refresh projects before continuing.`);
    }
    return scan;
  }

  async getScan(scanId: string, signal?: AbortSignal): Promise<CxScan> {
    const scan = scanFromCli(await this.json(['scan', 'show', `--scan-id=${scanId}`, '--format=json'], signal));
    if (scan.id !== scanId) throw new Error('The CLI returned a different scan. Refresh the scan list.');
    return scan;
  }

  async listScans(params: { limit?: number; offset?: number; projectId?: string; branch?: string } = {}, signal?: AbortSignal): Promise<{ scans: CxScan[]; totalCount: number; hasMore: boolean }> {
    const limit = Math.max(1, Math.min(1000, Math.floor(Number.isFinite(params.limit) ? params.limit! : 50)));
    const offset = Math.max(0, Math.floor(Number.isFinite(params.offset) ? params.offset! : 0));
    const filter = [`limit=${limit}`, `offset=${offset}`, 'sort=-created_at', ...(params.projectId ? [csvValue(`project-id=${params.projectId}`)] : []), ...(params.branch ? [csvValue(`branch=${params.branch}`)] : [])];
    const data = await this.json(['scan', 'list', '--format=json', `--filter=${filter.join(',')}`], signal);
    if (!Array.isArray(data)) throw new Error('The CLI returned an invalid scan list.');
    return { scans: data.map(scanFromCli), totalCount: data.length, hasMore: data.length === limit };
  }

  async cancelScan(scanId: string): Promise<void> {
    await this.command(['scan', 'cancel', `--scan-id=${scanId}`, '--retry=0']);
  }

  private async report(scanId: string, format: 'json' | 'summaryJSON', signal?: AbortSignal): Promise<unknown> {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'marx-cli-report-'));
    try {
      await this.command(['results', 'show', `--scan-id=${scanId}`, `--report-format=${format}`, '--output-name=report', `--output-path=${folder}`], { signal, timeoutMs: 10 * 60_000 });
      const target = path.join(folder, 'report.json');
      return await readCliReport(target, signal);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  }

  async reportSarif(scanId: string, signal?: AbortSignal): Promise<string> {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'marx-cli-sarif-'));
    try {
      await this.command(['results', 'show', `--scan-id=${scanId}`, '--report-format=sarif', '--output-name=report', `--output-path=${folder}`], { signal, timeoutMs: 10 * 60_000 });
      return await readCliReport(path.join(folder, 'report.sarif'), signal, 'sarif') as string;
    } finally { await fs.rm(folder, { recursive: true, force: true }); }
  }

  async getAllResults(scanId: string, max = Number.POSITIVE_INFINITY, signal?: AbortSignal): Promise<{ results: CxResult[]; totalCount: number; truncated: boolean }> {
    const data = record(await this.report(scanId, 'json', signal));
    const results = data.results === null && data.totalCount === 0 ? [] : data.results;
    if (!Array.isArray(results) || !Number.isSafeInteger(data.totalCount) || Number(data.totalCount) < results.length) throw new Error('The CLI returned an incomplete or unrecognized findings report.');
    if (data.scanID !== undefined && data.scanID !== scanId) throw new Error('The CLI report belongs to a different scan.');
    if (max !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(max) || max < 0)) throw new Error('Choose a valid results import limit.');
    signal?.throwIfAborted();
    return { results: results.slice(0, max).map(resultFromCli), totalCount: Number(data.totalCount), truncated: data.totalCount !== results.length || results.length > max };
  }

  async getScanSummary(scanId: string, signal?: AbortSignal): Promise<CxScanSummary | null> {
    const data = record(await this.report(scanId, 'summaryJSON', signal));
    const counts: Record<string, number> = {};
    for (const [target, source] of Object.entries({ critical: 'CriticalIssues', high: 'HighIssues', medium: 'MediumIssues', low: 'LowIssues', info: 'InfoIssues' })) {
      const value = data[source];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
      counts[target] = value;
    }
    return counts;
  }

  async triage(req: TriageRequest): Promise<void> {
    const { finding, state, severity, comment } = req;
    if (!comment.trim()) throw new Error('A comment is required when changing a result state.');
    if (!finding.projectId || !RESULT_STATES.some((item) => item.value === state)) throw new Error('A project and supported result state are required for triage.');
    const args = ['triage', 'update', `--project-id=${finding.projectId}`, `--state=${state}`, `--comment=${comment}`, '--retry=0'];
    if (finding.type === 'sca') {
      if (!finding.packageName || !finding.packageVersion || !finding.packageManager || !finding.cve) throw new Error('SCA CLI triage requires package name, version, package manager and vulnerability ID. Open this finding in Checkmarx One.');
      args.push('--scan-type=sca', `--vulnerability-identifiers=${[`packageName=${finding.packageName}`, `packageVersion=${finding.packageVersion}`, `packageManager=${finding.packageManager}`, `vulnerabilityId=${finding.cve}`].map(csvValue).join(',')}`);
    } else {
      if (!['sast', 'kics', 'iac-security'].includes(finding.type)) throw new Error('This finding type cannot be triaged through Marx’s CLI integration. Open it in Checkmarx One.');
      if (!finding.similarityId) throw new Error('This finding has no stable similarity identity. Review it in Checkmarx One before triage.');
      const selectedSeverity = severity ?? finding.severity;
      if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(selectedSeverity)) throw new Error('The original severity is unknown. Review it in Checkmarx One or choose a supported severity before triage.');
      args.push(`--scan-type=${finding.type === 'kics' ? 'iac-security' : finding.type}`, `--similarity-id=${finding.similarityId}`, `--severity=${selectedSeverity}`);
    }
    await this.command(args);
  }
}

function csvValue(value: string): string {
  return /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
