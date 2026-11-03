import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanJobState, Settings } from '../src/shared/types';
import type { WorkbenchBootstrap, WorkspaceState } from '../src/shared/workbench';

const api = vi.hoisted(() => ({
  settings: { get: vi.fn() },
  workbench: { bootstrap: vi.fn(), workspace: vi.fn(), saveWorkspace: vi.fn() },
  onScanEvent: vi.fn()
}));

vi.mock('../src/renderer/src/api', () => ({ api }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function bootstrap(connectionId = 'current', jobs: ScanJobState[] = []): WorkbenchBootstrap {
  return { connectionId, jobs, sessions: [], scans: [], logs: {} };
}

function job(id: string, connectionId = 'current'): ScanJobState {
  return {
    id, connectionId, folderPath: '/fixture', projectName: 'Fixture', branch: 'main', startedAt: 1,
    options: { scanners: ['sast'], branch: 'main', sastPreset: 'Default', sastIncremental: false, scaExploitablePath: false, excludes: [], tags: {} },
    status: 'Running', progress: { phase: 'running' }
  };
}

async function createStore() {
  const storePath = '../src/renderer/src/store';
  const { useApp } = await import(storePath);
  return useApp;
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  api.workbench.bootstrap.mockResolvedValue(bootstrap());
  api.workbench.workspace.mockResolvedValue(null);
  api.workbench.saveWorkspace.mockResolvedValue(undefined);
});

describe('workspace refresh ordering and connection scope', () => {
  it('ignores a bootstrap from a superseded connection refresh', async () => {
    const store = await createStore();
    const first = deferred<WorkbenchBootstrap>();
    api.workbench.bootstrap.mockReturnValueOnce(first.promise).mockResolvedValueOnce(bootstrap('new'));
    const earlier = store.getState().refreshWorkbench();
    await store.getState().refreshWorkbench();
    first.resolve(bootstrap('old', [job('old-job', 'old')]));
    await earlier;
    expect(store.getState().connectionId).toBe('new');
    expect(store.getState().jobs).toEqual([]);
    expect(api.workbench.workspace).toHaveBeenCalledTimes(1);
  });

  it('ignores navigation restored after a newer refresh has completed', async () => {
    const store = await createStore();
    const firstNavigation = deferred<WorkspaceState | null>();
    const running = job('old-job', 'old');
    api.workbench.bootstrap.mockResolvedValueOnce(bootstrap('old', [running])).mockResolvedValueOnce(bootstrap('new'));
    api.workbench.workspace.mockReturnValueOnce(firstNavigation.promise).mockResolvedValueOnce({ view: 'history' });
    const earlier = store.getState().refreshWorkbench();
    await vi.waitFor(() => expect(api.workbench.workspace).toHaveBeenCalledTimes(1));
    store.getState().applyEvent({ kind: 'job-updated', job: { ...running, status: 'Completed', finishedAt: 2, progress: { phase: 'completed' } } });
    expect(store.getState().jobs).toEqual([]);
    await store.getState().refreshWorkbench();
    firstNavigation.resolve({ view: 'results', selectedScanId: 'old-scan' });
    await earlier;
    expect(store.getState().connectionId).toBe('new');
    expect(store.getState().jobs).toEqual([]);
    expect(store.getState().view).toBe('history');
    expect(store.getState().selectedScanId).toBeNull();
    expect(api.workbench.bootstrap).toHaveBeenCalledTimes(2);
  });

  it.each([null, 'previous'])('reconciles completion during navigation restoration from %s', async (connectionId) => {
    const store = await createStore();
    const previousJobs = connectionId ? [job('previous-job', connectionId)] : [];
    store.setState({ initialized: Boolean(connectionId), connectionId, jobs: previousJobs });
    const running = job('incoming-job');
    const completed: ScanJobState = { ...running, status: 'Completed', finishedAt: 2, progress: { phase: 'completed' } };
    const firstNavigation = deferred<WorkspaceState | null>();
    api.workbench.bootstrap.mockResolvedValueOnce(bootstrap('current', [running])).mockResolvedValueOnce(bootstrap('current', [completed]));
    api.workbench.workspace.mockReturnValueOnce(firstNavigation.promise).mockResolvedValueOnce({ connectionId: 'current', view: 'history' });
    const refresh = store.getState().refreshWorkbench();
    await vi.waitFor(() => expect(api.workbench.workspace).toHaveBeenCalledTimes(1));
    store.getState().applyEvent({ kind: 'job-updated', job: { ...completed, id: 'foreign-job', connectionId: 'foreign' } });
    store.getState().applyEvent({ kind: 'job-updated', job: completed });
    store.getState().applyEvent({ kind: 'log', jobId: running.id, line: 'Incoming connection diagnostic' });
    expect(store.getState().connectionId).toBe(connectionId);
    expect(store.getState().jobs).toEqual(previousJobs);
    expect(store.getState().logs).toEqual({});
    expect(api.workbench.bootstrap).toHaveBeenCalledTimes(1);
    firstNavigation.resolve({ connectionId: 'current', view: 'results', selectedScanId: 'stale-scan' });
    await refresh;
    expect(store.getState().connectionId).toBe('current');
    expect(store.getState().jobs).toEqual([completed]);
    expect(store.getState().view).toBe('history');
    expect(store.getState().selectedScanId).toBeNull();
    expect(api.workbench.bootstrap).toHaveBeenCalledTimes(2);
  });

  it('reports a failed reconciliation after completion during restoration', async () => {
    const store = await createStore();
    const running = job('incoming-job');
    const firstNavigation = deferred<WorkspaceState | null>();
    api.settings.get.mockResolvedValue({ tenant: 'current' });
    api.workbench.bootstrap.mockResolvedValueOnce(bootstrap('current', [running])).mockRejectedValueOnce(new Error('Synthetic reconciliation failure'));
    api.workbench.workspace.mockReturnValueOnce(firstNavigation.promise);
    const initialization = store.getState().init();
    await vi.waitFor(() => expect(api.workbench.workspace).toHaveBeenCalledTimes(1));
    store.getState().applyEvent({ kind: 'job-updated', job: { ...running, status: 'Completed', finishedAt: 2, progress: { phase: 'completed' } } });
    firstNavigation.resolve(null);
    await initialization;
    expect(store.getState().workbenchError).toBe('Synthetic reconciliation failure');
    expect(store.getState().initialized).toBe(true);
    expect(store.getState().jobs).toEqual([]);
  });

  it('does not overwrite a newer success with a superseded read error', async () => {
    const store = await createStore();
    const first = deferred<WorkbenchBootstrap>();
    api.workbench.bootstrap.mockReturnValueOnce(first.promise).mockResolvedValueOnce(bootstrap());
    const earlier = store.getState().refreshWorkbench();
    await store.getState().refreshWorkbench();
    first.reject(new Error('Old connection unavailable'));
    await expect(earlier).resolves.toBeUndefined();
    expect(store.getState().workbenchError).toBeNull();
  });

  it('ignores jobs and diagnostic lines outside the active connection', async () => {
    const store = await createStore();
    store.setState({ initialized: true, connectionId: 'current', jobs: [job('active')], batchId: 'active-batch' });
    store.getState().applyEvent({ kind: 'job-updated', job: job('foreign', 'old') });
    store.getState().applyEvent({ kind: 'job-list', jobs: [{ ...job('foreign', 'old'), batchId: 'foreign-batch' }] });
    store.getState().applyEvent({ kind: 'log', jobId: 'foreign', line: 'Other connection diagnostic' });
    store.getState().applyEvent({ kind: 'log', jobId: 'active', line: 'Current diagnostic' });
    expect(store.getState().jobs.map((item: ScanJobState) => item.id)).toEqual(['active']);
    expect(store.getState().batchId).toBe('active-batch');
    expect(store.getState().logs).toEqual({ active: ['Current diagnostic'] });
  });

  it('preserves a newer job event received during a bootstrap read', async () => {
    const store = await createStore();
    const running = job('active');
    store.setState({ initialized: true, connectionId: 'current', jobs: [running] });
    const read = deferred<WorkbenchBootstrap>();
    api.workbench.bootstrap.mockReturnValueOnce(read.promise);
    const refresh = store.getState().refreshWorkbench();
    store.getState().applyEvent({ kind: 'job-updated', job: { ...running, progress: { phase: 'running', detail: 'New progress' } } });
    read.resolve(bootstrap('current', [running]));
    await refresh;
    expect(store.getState().jobs[0].progress.detail).toBe('New progress');
  });

  it('removes jobs that were pruned from the saved workspace', async () => {
    const store = await createStore();
    store.setState({ initialized: true, connectionId: 'current', jobs: [{ ...job('pruned'), status: 'Completed', finishedAt: 2 }], logs: { pruned: ['Old output'] } });
    await store.getState().refreshWorkbench();
    expect(store.getState().jobs).toEqual([]);
    expect(store.getState().logs).toEqual({});
  });

  it('does not restore stale settings after a later initialization', async () => {
    const store = await createStore();
    const first = deferred<Settings>();
    api.settings.get.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ tenant: 'new' });
    const earlier = store.getState().init();
    await store.getState().init();
    first.resolve({ tenant: 'old' } as Settings);
    await earlier;
    expect(store.getState().settings.tenant).toBe('new');
    expect(api.workbench.bootstrap).toHaveBeenCalledTimes(1);
  });

  it('recovers from an initial settings read failure', async () => {
    const store = await createStore();
    api.settings.get.mockRejectedValueOnce(new Error('Synthetic settings read failure')).mockResolvedValueOnce({ tenant: 'current' });
    await store.getState().init();
    expect(store.getState().workbenchError).toBe('Synthetic settings read failure');
    expect(store.getState().settings).toBeNull();
    await store.getState().init();
    expect(store.getState().settings.tenant).toBe('current');
    expect(store.getState().workbenchError).toBeNull();
  });

  it('pins persisted navigation to the active connection', async () => {
    const store = await createStore();
    store.setState({ initialized: true, connectionId: 'current' });
    store.getState().setView('history');
    expect(api.workbench.saveWorkspace).toHaveBeenCalledWith('navigation', expect.objectContaining({ connectionId: 'current', view: 'history' }));
  });

  it('ignores a previous connection save failure while draining newer navigation', async () => {
    const store = await createStore();
    const previousSave = deferred<void>();
    api.workbench.saveWorkspace.mockReturnValueOnce(previousSave.promise);
    store.setState({ initialized: true, connectionId: 'old' });
    store.getState().setView('history');
    await store.getState().refreshWorkbench();
    store.getState().setView('results');
    previousSave.reject(new Error('Connection changed; reload the workspace'));
    await vi.waitFor(() => expect(api.workbench.saveWorkspace).toHaveBeenCalledTimes(2));
    expect(store.getState().workbenchError).toBeNull();
    expect(api.workbench.saveWorkspace).toHaveBeenLastCalledWith('navigation', expect.objectContaining({ connectionId: 'current', view: 'results' }));
  });

  it('still reports navigation failures for the active connection', async () => {
    const store = await createStore();
    api.workbench.saveWorkspace.mockRejectedValueOnce(new Error('Synthetic save failure'));
    store.setState({ initialized: true, connectionId: 'current' });
    store.getState().setView('history');
    await vi.waitFor(() => expect(store.getState().workbenchError).toBe('Could not save workspace: Synthetic save failure'));
  });

  it('ignores saved navigation explicitly scoped to another connection', async () => {
    const store = await createStore();
    api.workbench.workspace.mockResolvedValueOnce({ connectionId: 'old', view: 'results', selectedScanId: 'old-scan', linkedFolder: '/old', selectedSessionId: 'old-session', workbenchTab: 'decisions' });
    await store.getState().refreshWorkbench();
    expect(store.getState().connectionId).toBe('current');
    expect(store.getState().view).toBe('scan');
    expect(store.getState().selectedScanId).toBeNull();
    expect(store.getState().linkedFolder).toBeNull();
    expect(store.getState().selectedSessionId).toBeNull();
    expect(store.getState().workbenchTab).toBe('sessions');
  });
});
