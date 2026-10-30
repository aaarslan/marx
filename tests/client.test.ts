import { describe, expect, it, vi } from 'vitest';
import { CxOneClient, CxOneApiError } from '../src/main/cxone/client';
import { makeJwt } from './helpers';

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn((url: string | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(url), init))
  ) as unknown as typeof fetch;
}

describe('CxOneClient auth + requests', () => {
  const apiKey = makeJwt({
    aud: 'https://acme.iam.checkmarx.net/auth/realms/acme',
    azp: 'ast-app'
  });
  const accessToken = makeJwt({ 'ast-base-url': 'https://acme.ast.checkmarx.net' });

  it('exchanges the API key for an access token and derives the API base', async () => {
    const calls: string[] = [];
    const fetchMock = mockFetch((url) => {
      calls.push(url);
      if (url.includes('openid-connect/token')) {
        return new Response(
          JSON.stringify({ access_token: accessToken, expires_in: 3600 }),
          { status: 200 }
        );
      }
      if (url.includes('api/projects')) {
        return new Response(JSON.stringify({ totalCount: 0, projects: [] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });

    const client = new CxOneClient({ apiKey }, fetchMock);
    const { projects } = await client.listProjects();
    expect(projects).toEqual([]);
    expect(calls[0]).toBe('https://acme.iam.checkmarx.net/auth/realms/acme/protocol/openid-connect/token');
    expect(calls[1]).toContain('https://acme.ast.checkmarx.net/api/projects');
    // auth request must use the refresh_token grant with the azp client id
    const body = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1]?.body as string;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('client_id=ast-app');
    expect(body).toContain(`refresh_token=${apiKey}`);
  });

  it('prefers a manually configured base URL over the JWT claim', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: accessToken, expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ totalCount: 0, projects: [] }), { status: 200 });
    });
    const client = new CxOneClient({ apiKey, baseUrl: 'https://override.ast.checkmarx.net/' }, fetchMock);
    await client.listProjects(1);
    const calls = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.map((c) => c[0]);
    expect(calls[1]).toContain('https://override.ast.checkmarx.net/api/projects');
  });

  it('surfaces auth failures with status', async () => {
    const fetchMock = mockFetch(
      () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );
    const client = new CxOneClient({ apiKey }, fetchMock);
    await expect(client.listProjects()).rejects.toThrow(CxOneApiError);
  });

  it('builds the scan request with per-scanner config', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.includes('openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: accessToken, expires_in: 3600 }), { status: 200 });
      }
      if (url.includes('POST') || init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'scan-1', status: 'Queued' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    const client = new CxOneClient({ apiKey }, fetchMock);
    const scan = await client.createScan({
      type: 'upload',
      handler: { branch: 'main', uploadUrl: 'https://s3/presigned' },
      project: { id: 'p1' },
      config: [
        { type: 'sast', value: { incremental: 'true', presetName: 'Checkmarx Default' } },
        { type: 'sca', value: { ExploitablePath: 'true' } }
      ]
    });
    expect(scan.id).toBe('scan-1');
    const body = JSON.parse(
      (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
        .find((c) => c[0].includes('api/scans'))![1].body as string
    );
    expect(body.type).toBe('upload');
    expect(body.handler.uploadUrl).toBe('https://s3/presigned');
    expect(body.config).toEqual([
      { type: 'sast', value: { incremental: 'true', presetName: 'Checkmarx Default' } },
      { type: 'sca', value: { ExploitablePath: 'true' } }
    ]);
  });
});
