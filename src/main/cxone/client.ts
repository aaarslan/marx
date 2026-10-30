import fs from 'node:fs';
import { Readable } from 'node:stream';
import {
  apiBaseFromAccessToken,
  authEndpointFromApiKey,
  authEndpointFromTenant,
  clientIdFromApiKey
} from './jwt';

export interface CxOneCredentials {
  apiKey: string;
  /** manual overrides (optional — API key usually self-describes) */
  baseUrl?: string;
  tenant?: string;
}

export class CxOneApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly endpoint?: string,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'CxOneApiError';
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

export type FetchLike = typeof fetch;

/**
 * Thin client over the Checkmarx One REST API.
 *
 * Auth flow (mirrors the official ast-cli):
 *  - the stored API key is a Keycloak refresh-token JWT; its `aud` claim points
 *    at the tenant realm, its `azp` claim names the OAuth client
 *  - POST grant_type=refresh_token → 1h access token (cached, refreshed early)
 *  - the access token's `ast-base-url` claim is the API base URL
 */
export class CxOneClient {
  private tokenRequest: Promise<string> | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private resolvedBase: string | null = null;
  private resolvedAuthEndpoint: string | null = null;

  constructor(
    private readonly creds: CxOneCredentials,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  /** Force re-auth on next call (used after 401s or credential changes). */
  invalidate(): void {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.resolvedBase = null;
  }

  async getApiBase(): Promise<string> {
    if (this.resolvedBase) return this.resolvedBase;
    if (this.creds.baseUrl?.trim()) {
      this.resolvedBase = this.creds.baseUrl.trim().replace(/\/+$/, '');
      return this.resolvedBase;
    }
    const token = await this.ensureToken();
    const fromClaim = apiBaseFromAccessToken(token);
    if (!fromClaim) {
      throw new CxOneApiError(
        'Could not determine the Checkmarx One API base URL. Set it explicitly in Settings.',
        undefined,
        'auth'
      );
    }
    this.resolvedBase = fromClaim;
    return this.resolvedBase;
  }

  async testConnection(): Promise<{ apiBase: string; authEndpoint: string }> {
    await this.ensureToken();
    await this.getApiBase();
    return { apiBase: this.resolvedBase!, authEndpoint: this.resolvedAuthEndpoint ?? '(derived)' };
  }

  private async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    if (this.tokenRequest) return this.tokenRequest;
    const pending = this.authenticate();
    this.tokenRequest = pending;
    try { return await pending; } finally { if (this.tokenRequest === pending) this.tokenRequest = null; }
  }

  private async authenticate(): Promise<string> {
    const authEndpoint =
      authEndpointFromApiKey(this.creds.apiKey) ??
      authEndpointFromTenant(this.creds.tenant ?? '');
    if (!authEndpoint) {
      throw new CxOneApiError(
        'This API key does not self-describe and no tenant is configured. Enter your tenant in Settings.',
        undefined,
        'auth'
      );
    }
    this.resolvedAuthEndpoint = authEndpoint;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientIdFromApiKey(this.creds.apiKey),
      refresh_token: this.creds.apiKey
    });

    requireHttps(authEndpoint);
    const resp = await this.fetchImpl(authEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(30_000),
      body: body.toString()
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new CxOneApiError(
        `Authentication failed (${resp.status}). Check your API key. ${truncate(text, 200)}`,
        resp.status,
        authEndpoint
      );
    }
    const json = (await resp.json()) as TokenResponse;
    this.accessToken = json.access_token;
    this.tokenExpiresAt = Date.now() + json.expires_in * 1000;
    return this.accessToken!;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; raw?: Blob; contentType?: string; retryOn401?: boolean; signal?: AbortSignal } = {}
  ): Promise<T> {
    const base = await this.getApiBase();
    const token = await this.ensureToken();
    const url = path.startsWith('http') ? path : `${base}/${path.replace(/^\/+/, '')}`;

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let body: string | Blob | undefined;
    if (opts.raw !== undefined) {
      body = opts.raw;
      if (opts.contentType) headers['Content-Type'] = opts.contentType;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json;v=1.0';
      headers.Accept = 'application/json;v=1.0';
      body = JSON.stringify(opts.body);
    }

    const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
    requireHttps(url);
    const resp = await this.fetchImpl(url, { method, headers, body, signal });

    if (resp.status === 401 && opts.retryOn401 !== false) {
      // token likely expired mid-flight: refresh once and retry
      await resp.body?.cancel();
      if (this.accessToken === token) this.accessToken = null;
      return this.request<T>(method, path, { ...opts, retryOn401: false });
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      let message = text;
      try {
        const parsed = JSON.parse(text);
        message = parsed.message ?? parsed.error ?? text;
      } catch {
        /* keep raw text */
      }
      throw new CxOneApiError(
        `${method} ${path} failed (${resp.status}): ${truncate(message, 300)}`,
        resp.status,
        path,
        retryAfter(resp.headers.get('Retry-After'))
      );
    }
    if (resp.status === 204) return undefined as T;
    const text = await resp.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // ---- projects -----------------------------------------------------------

  async listProjects(limit = 1000, signal?: AbortSignal): Promise<CxProjectCollection & { totalCount: number; truncated: boolean }> {
    const out: CxProject[] = [];
    const pageSize = 100;
    let totalCount: number | undefined;
    let complete = false;
    const ids = new Set<string>();
    // page through until we hit the tenant's total or the safety cap
    for (let offset = 0; offset < limit; offset += pageSize) {
      const requested = Math.min(pageSize, limit - offset);
      const page = await this.request<CxProjectCollection>(
        'GET',
        `api/projects?limit=${requested}&offset=${offset}&sort=name`,
        { signal }
      );
      const batch = page.projects;
      if (!Array.isArray(batch) || batch.length > requested) {
        throw new CxOneApiError('The project list returned an invalid page. Refresh the list and retry.', undefined, 'api/projects');
      }
      for (const project of batch) {
        if (!project || typeof project.id !== 'string' || !project.id || typeof project.name !== 'string' || ids.has(project.id)) {
          throw new CxOneApiError('The project list returned invalid or duplicate entries. Refresh the list and retry.', undefined, 'api/projects');
        }
        ids.add(project.id);
      }
      if (page.totalCount !== undefined) {
        if (!Number.isSafeInteger(page.totalCount) || page.totalCount < 0) {
          throw new CxOneApiError('The project list returned an invalid total count. Refresh the list and retry.', undefined, 'api/projects');
        }
        totalCount = page.totalCount;
      }
      out.push(...batch.slice(0, limit - out.length));
      if (totalCount !== undefined && out.length > totalCount) {
        throw new CxOneApiError('The project list returned inconsistent counts. Refresh the list and retry.', undefined, 'api/projects');
      }
      complete = totalCount === undefined ? batch.length < requested : out.length === totalCount;
      if (complete || batch.length < requested) break;
    }
    return { totalCount: totalCount ?? out.length, projects: out, truncated: !complete };
  }

  async createProject(name: string, mainBranch?: string, tags?: Record<string, string>): Promise<CxProject> {
    return this.request<CxProject>('POST', 'api/projects', {
      body: { name, ...(mainBranch ? { mainBranch } : {}), ...(tags && Object.keys(tags).length ? { tags } : {}) }
    });
  }

  // ---- uploads ------------------------------------------------------------

  /** Returns a presigned URL for the source zip. */
  async createUploadUrl(signal?: AbortSignal): Promise<string> {
    const model = await this.request<{ url: string }>('POST', 'api/uploads', { body: {}, signal });
    return model.url;
  }

  /** PUT raw bytes at the presigned URL (no auth header). Reports bytes handed
   *  to the socket so the UI can show upload progress. */
  async uploadZip(uploadUrl: string, data: Buffer | { path: string; bytes: number }, onProgress?: (sent: number) => void, signal?: AbortSignal): Promise<void> {
    requireHttps(uploadUrl);
    const total = Buffer.isBuffer(data) ? data.length : data.bytes;
    const input = Buffer.isBuffer(data)
      ? Readable.from((function* () {
          for (let off = 0; off < data.length; off += 512 * 1024) yield data.subarray(off, off + 512 * 1024);
        })())
      : fs.createReadStream(data.path, { highWaterMark: 512 * 1024 });
    let sent = 0;
    const stream = Readable.toWeb(input, { strategy: { highWaterMark: 1024 * 1024, size: (chunk) => chunk.byteLength } }) as ReadableStream<Uint8Array>;
    const inactivity = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout>;
    const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => inactivity.abort(new Error('Upload stalled for five minutes.')), 5 * 60_000); };
    resetIdle();
    const progress = stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        resetIdle();
        sent += chunk.byteLength;
        onProgress?.(sent);
        controller.enqueue(chunk);
      }
    }));
    let resp: Response;
    try {
      resp = await this.fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Length': String(total) },
        signal: AbortSignal.any([...(signal ? [signal] : []), inactivity.signal, AbortSignal.timeout(24 * 60 * 60_000)]),
        body: progress,
        duplex: 'half'
      } as RequestInit);
      await resp.arrayBuffer();
    } finally {
      clearTimeout(idleTimer!);
      input.destroy();
      await progress.cancel().catch(() => undefined);
    }
    if (!resp.ok) {
      throw new CxOneApiError(`Source upload failed (${resp.status})`, resp.status, uploadUrl);
    }
  }

  // ---- scans --------------------------------------------------------------

  async createScan(req: CxScanCreateRequest): Promise<CxScan> {
    return this.request<CxScan>('POST', 'api/scans', { body: req });
  }

  async getScan(scanId: string, signal?: AbortSignal): Promise<CxScan> {
    return this.request<CxScan>('GET', `api/scans/${scanId}`, { signal });
  }

  async listScans(params: {
    projectId?: string;
    statuses?: string[];
    limit?: number;
    offset?: number;
  } = {}): Promise<CxScanCollection> {
    const q = new URLSearchParams();
    if (params.projectId) q.set('project-id', params.projectId);
    if (params.statuses?.length) q.set('statuses', params.statuses.join(','));
    q.set('limit', String(params.limit ?? 50));
    if (params.offset) q.set('offset', String(params.offset));
    return this.request<CxScanCollection>('GET', `api/scans?${q.toString()}`);
  }

  async cancelScan(scanId: string): Promise<void> {
    await this.request<void>('PATCH', `api/scans/${scanId}`, {
      body: { status: 'Canceled' }
    });
  }

  // ---- results ------------------------------------------------------------

  async getResultsPage(
    scanId: string,
    page: { limit: number; offset: number }
  ): Promise<CxResultsCollection> {
    return this.request<CxResultsCollection>(
      'GET',
      `api/results?scan-id=${scanId}&limit=${page.limit}&offset=${page.offset}`
    );
  }

  /** Fetch every finding for a scan (paged). */
  async getAllResults(scanId: string, max = 5000): Promise<{ results: CxResult[]; totalCount: number; truncated: boolean }> {
    const all: CxResult[] = [];
    const limit = 100;
    let totalCount: number | undefined;
    for (let offset = 0; offset < max;) {
      const count = totalCount === undefined ? 1 : Math.min(3, Math.ceil((Math.min(totalCount, max) - offset) / limit));
      if (count <= 0) break;
      const pages = await Promise.all(Array.from({ length: count }, (_, i) => this.getResultsPage(scanId, {
        limit: Math.min(limit, max - offset - i * limit), offset: offset + i * limit
      })));
      for (const [index, page] of pages.entries()) {
        const requested = Math.min(limit, max - offset - index * limit);
        const batch = page.results ?? [];
        if (typeof page.totalCount === 'number') totalCount = page.totalCount;
        all.push(...batch.slice(0, max - all.length));
        if ((totalCount !== undefined && all.length >= totalCount) || batch.length < requested) {
          return { results: all, totalCount: totalCount ?? all.length, truncated: totalCount !== undefined && all.length < totalCount };
        }
      }
      offset += count * limit;
    }
    return { results: all, totalCount: totalCount ?? all.length, truncated: totalCount === undefined || all.length < totalCount };
  }

  async getScanSummary(scanId: string, signal?: AbortSignal): Promise<CxScanSummary | null> {
    try {
      return await this.request<CxScanSummary>('GET', `api/scan-summary?scan-id=${scanId}`, { signal });
    } catch {
      return null; // summary is best-effort
    }
  }

  // ---- triage -------------------------------------------------------------

  async triageSast(predicate: CxPredicate): Promise<void> {
    // SAST/KICS predicates are sent as an array
    await this.request<void>('POST', 'api/sast-results-predicates', { body: [predicate] });
  }

  async triageSca(predicate: CxScaPredicate): Promise<void> {
    // SCA risk management takes a single object
    await this.request<void>('POST', 'api/sca/management-of-risk/package-vulnerabilities', {
      body: predicate
    });
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ---- API DTOs (field names verified against the official ast-cli) ---------

export interface CxProject {
  id: string;
  name: string;
  mainBranch?: string;
  repoUrl?: string;
  tags?: Record<string, string>;
}

export interface CxProjectCollection {
  totalCount?: number;
  projects: CxProject[];
}

export interface CxScanCreateRequest {
  type: 'upload' | 'git';
  handler: {
    branch?: string;
    repoUrl?: string;
    uploadUrl?: string;
  };
  project: { id: string; tags?: Record<string, string> };
  config: { type: string; value: Record<string, unknown> }[];
  tags?: Record<string, string>;
}

export interface CxScan {
  id: string;
  status: string;
  positionInQueue?: number;
  statusDetails?: { name?: string; status?: string; details?: string; errorCode?: string };
  branch?: string;
  createdAt?: string;
  updatedAt?: string;
  projectId?: string;
  projectName?: string;
  sourceOrigin?: string;
  tags?: Record<string, string>;
}

export interface CxScanCollection {
  totalCount: number;
  filteredTotalCount?: number;
  scans: CxScan[];
}

export interface CxScanSummary {
  scanId?: string;
  scans?: { scanId: string; [k: string]: unknown }[];
  high?: number;
  medium?: number;
  low?: number;
  info?: number;
  critical?: number;
  [k: string]: unknown;
}

export interface CxResultNode {
  id?: string;
  line?: number;
  column?: number;
  name?: string;
  fileName?: string;
  fullName?: string;
  method?: string;
  typeName?: string;
}

export interface CxResult {
  id: string;
  type: string;
  label?: string;
  similarityId?: string;
  status?: string;
  state?: string;
  severity?: string;
  created?: string;
  description?: string;
  descriptionHTML?: string;
  comments?: unknown;
  vulnerabilityDetails?: {
    cweId?: string | number;
    cveName?: string;
    cvssScore?: number;
    compliances?: string[];
  };
  data?: {
    queryName?: string;
    group?: string;
    languageName?: string;
    nodes?: CxResultNode[];
    // SCA
    scaType?: string;
    packageIdentifier?: { name?: string; version?: string };
    recommendedVersion?: string;
    scaPackageData?: {
      isDirectDependency?: boolean;
      typeOfDependency?: string;
      fixLink?: string;
      locations?: { path?: string; line?: number }[];
    };
    // KICS
    line?: number;
    filename?: string;
    platform?: string;
  };
}

export interface CxResultsCollection {
  results?: CxResult[];
  totalCount?: number;
}

export interface CxPredicate {
  similarityId: string;
  projectId: string;
  state: string;
  severity: string;
  comment: string;
}

export interface CxScaPredicate {
  packageName: string;
  packageVersion: string;
  packageManager?: string;
  vulnerabilityId: string;
  projectIds?: string[];
  actions: { ActionType: string; Value: string; Comment?: string }[];
}

function requireHttps(value: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new CxOneApiError('Checkmarx endpoints must use HTTPS without embedded credentials.');
}

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}
