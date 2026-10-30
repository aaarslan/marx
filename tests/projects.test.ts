import { describe, expect, it, vi } from 'vitest';
import { CxOneClient } from '../src/main/cxone/client';
import { ScanRunner } from '../src/main/scanRunner';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { makeJwt } from './helpers';

const apiKey = makeJwt({ aud: 'https://auth.example.test/realms/test' });
const token = makeJwt({ 'ast-base-url': 'https://api.example.test' });
const projects = (count: number, offset = 0) => Array.from({ length: count }, (_, i) => ({ id: `p${offset + i}`, name: `project-${offset + i}` }));
const response = (data: unknown) => Response.json(data);

function fixture(page: (url: URL) => unknown) {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.includes('openid-connect')) return response({ access_token: token, expires_in: 3600 });
    if (url.pathname === '/api/projects' && init?.method === 'POST') return response({ id: 'created-project', name: 'new-project' });
    return response(page(url));
  });
  return { client: new CxOneClient({ apiKey }, fetcher as typeof fetch), fetcher };
}

function run(client: CxOneClient, name: string) {
  const runner = new ScanRunner(() => client, { onJobUpdated: vi.fn(), onLog: vi.fn() });
  return runner.run(runner.newJob({ folderPath: '/nonexistent-marx-project-fixture', projectName: name, options: { ...DEFAULT_SETTINGS.defaults, branch: 'main', excludes: [], tags: {} } }));
}

const creations = (fetcher: ReturnType<typeof fixture>['fetcher']) => fetcher.mock.calls.filter(([input, init]) => init?.method === 'POST' && new URL(String(input)).pathname === '/api/projects');

describe('complete project lookup', () => {
  it('preserves tenant totals and reports a capped list', async () => {
    const { client, fetcher } = fixture(() => ({ totalCount: 50, projects: projects(2) }));
    expect(await client.listProjects(2)).toMatchObject({ totalCount: 50, truncated: true, projects: projects(2) });
    expect(String(fetcher.mock.calls[1][0])).toContain('limit=2&offset=0&sort=name');
  });

  it('distinguishes an exact known cap from an unknown full page', async () => {
    const known = fixture(() => ({ totalCount: 100, projects: projects(100) }));
    expect((await known.client.listProjects(100)).truncated).toBe(false);
    const unknown = fixture(() => ({ projects: projects(100) }));
    expect((await unknown.client.listProjects(100)).truncated).toBe(true);
    expect(unknown.fetcher).toHaveBeenCalledTimes(2);
  });

  it('accepts an exhausted unknown-total list but flags a contradictory short page', async () => {
    const short = fixture(() => ({ projects: projects(1) }));
    expect(await short.client.listProjects()).toMatchObject({ totalCount: 1, truncated: false });
    const inconsistent = fixture(() => ({ totalCount: 200, projects: projects(1) }));
    expect((await inconsistent.client.listProjects()).truncated).toBe(true);
    const malformed = fixture(() => ({ totalCount: -1, projects: [] }));
    await expect(malformed.client.listProjects()).rejects.toThrow('invalid total count');
    const oversized = fixture(() => ({ totalCount: 0, projects: projects(1) }));
    await expect(oversized.client.listProjects()).rejects.toThrow('inconsistent counts');
    const missing = fixture(() => ({}));
    await expect(missing.client.listProjects()).rejects.toThrow('invalid page');
    const ignoredLimit = fixture(() => ({ totalCount: 2, projects: projects(2) }));
    await expect(ignoredLimit.client.listProjects(1)).rejects.toThrow('invalid page');
    const overlapping = fixture(() => ({ totalCount: 200, projects: projects(100) }));
    await expect(overlapping.client.listProjects()).rejects.toThrow('duplicate entries');
  });

  it('blocks creation after a capped lookup without zipping or submitting a scan', async () => {
    const { client, fetcher } = fixture((url) => ({ totalCount: 1001, projects: projects(100, Number(url.searchParams.get('offset'))) }));
    const job = await run(client, 'not-in-the-first-1000');
    expect(job.status).toBe('Failed');
    expect(job.error).toContain('blocked to avoid a duplicate');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(creations(fetcher)).toHaveLength(0);
  });

  it('reuses an existing match even when the tenant list is capped', async () => {
    const { client, fetcher } = fixture((url) => ({ totalCount: 1001, projects: projects(100, Number(url.searchParams.get('offset'))) }));
    const job = await run(client, 'PROJECT-2');
    expect(job.projectId).toBe('p2');
    expect(creations(fetcher)).toHaveLength(0);
  });

  it('creates only after complete absence is established', async () => {
    const { client, fetcher } = fixture(() => ({ totalCount: 0, projects: [] }));
    const job = await run(client, 'new-project');
    expect(job.projectId).toBe('created-project');
    expect(creations(fetcher)).toHaveLength(1);
  });

  it('does not create a project when cancellation arrives during lookup', async () => {
    let finish!: (page: { totalCount: number; projects: []; truncated: false }) => void;
    const client = { listProjects: vi.fn(() => new Promise((resolve) => { finish = resolve; })), createProject: vi.fn() };
    const runner = new ScanRunner(() => client as unknown as CxOneClient, { onJobUpdated: vi.fn(), onLog: vi.fn() });
    const job = runner.newJob({ folderPath: '/unused', projectName: 'new-project', options: { ...DEFAULT_SETTINGS.defaults, branch: 'main', excludes: [], tags: {} } });
    const pending = runner.run(job);
    await runner.cancelJob(job);
    finish({ totalCount: 0, projects: [], truncated: false });
    expect((await pending).status).toBe('Canceled');
    expect(client.createProject).not.toHaveBeenCalled();
  });

});
