import { create } from 'zustand';
import type { ScanEvent, ScanHistoryItem, ScanJobState, Settings } from '@shared/types';
import type { RemediationSession, WorkspaceState } from '@shared/workbench';
import type { MenuAction } from '@shared/ipc';
import { api } from './api';

export type View = 'scan' | 'batch' | 'results' | 'history' | 'workbench' | 'intelligence' | 'settings';

interface AppState {
  view: View;
  settings: Settings | null;
  jobs: ScanJobState[];
  batchId: string | null;
  logs: Record<string, string[]>;
  sessions: RemediationSession[];
  cachedScans: ScanHistoryItem[];
  connectionId: string | null;
  initialized: boolean;
  workbenchError: string | null;
  workbenchTab: 'sessions' | 'activity' | 'decisions';
  selectedSessionId: string | null;
  selectedScanId: string | null;
  linkedFolder: string | null;
  menuAction: MenuAction | null;
  menuActionId: number;
  historyVersion: number;
  pendingAutoBaseline: boolean;
  setView: (v: View) => void;
  init: () => Promise<void>;
  refreshWorkbench: () => Promise<void>;
  setWorkbenchTab: (tab: 'sessions' | 'activity' | 'decisions') => void;
  openSession: (sessionId: string) => void;
  applyEvent: (e: ScanEvent) => void;
  setSelectedScan: (scanId: string | null, folder?: string | null, autoBaseline?: boolean) => void;
  clearAutoBaseline: () => void;
  triggerMenuAction: (action: MenuAction) => void;
}

let subscribed = false;
const VIEWS: View[] = ['scan', 'batch', 'results', 'history', 'workbench', 'intelligence', 'settings'];

function navigation(state: AppState): WorkspaceState {
  return {
    connectionId: state.connectionId ?? undefined,
    view: state.view,
    selectedScanId: state.selectedScanId,
    linkedFolder: state.linkedFolder,
    selectedSessionId: state.selectedSessionId ?? undefined,
    workbenchTab: state.workbenchTab
  };
}

export const useApp = create<AppState>((set, get) => {
  let initializationRead = 0;
  let workbenchRead = 0;
  let pendingWorkbench: { request: number; settledConnections: Set<string> } | null = null;
  let jobRevision = 0;
  const jobRevisions = new Map<string, number>();
  let pendingNavigation: { connectionId: string | null; state: WorkspaceState } | null = null;
  let savingNavigation = false;
  const persist = () => {
    if (!get().initialized) return;
    pendingNavigation = { connectionId: get().connectionId, state: navigation(get()) };
    if (savingNavigation) return;
    savingNavigation = true;
    void (async () => {
      try {
        while (pendingNavigation) {
          const next = pendingNavigation;
          pendingNavigation = null;
          if (next.connectionId !== get().connectionId) continue;
          try { await api.workbench.saveWorkspace('navigation', next.state); }
          catch (error) { if (next.connectionId === get().connectionId) set({ workbenchError: `Could not save workspace: ${error instanceof Error ? error.message : String(error)}` }); }
        }
      } finally { savingNavigation = false; }
    })();
  };
  return {
    view: 'scan',
    settings: null,
    jobs: [],
    batchId: null,
    logs: {},
    sessions: [],
    cachedScans: [],
    connectionId: null,
    initialized: false,
    workbenchError: null,
    workbenchTab: 'sessions',
    selectedSessionId: null,
    selectedScanId: null,
    linkedFolder: null,
    menuAction: null,
    menuActionId: 0,
    historyVersion: 0,
    pendingAutoBaseline: false,

    setView: (view) => { set({ view }); persist(); },
    setWorkbenchTab: (workbenchTab) => { set({ workbenchTab }); persist(); },
    openSession: (selectedSessionId) => { set({ selectedSessionId, workbenchTab: 'sessions', view: 'workbench' }); persist(); },

    init: async () => {
      const request = ++initializationRead;
      workbenchRead++;
      if (!subscribed) {
        subscribed = true;
        api.onScanEvent((event) => get().applyEvent(event));
      }
      try {
        const settings = await api.settings.get();
        if (request !== initializationRead) return;
        set({ settings });
        await get().refreshWorkbench();
      } catch (error) {
        if (request === initializationRead) set({ workbenchError: error instanceof Error ? error.message : String(error), initialized: true });
      }
    },

    refreshWorkbench: async () => {
      const request = ++workbenchRead;
      const revision = jobRevision;
      const pending = { request, settledConnections: new Set<string>() };
      pendingWorkbench = pending;
      try {
        const data = await api.workbench.bootstrap();
        if (request !== workbenchRead) return;
        const restore = !get().initialized || data.connectionId !== get().connectionId;
        const restored = restore ? await api.workbench.workspace('navigation') : null;
        if (request !== workbenchRead) return;
        if (restore && data.connectionId && pending.settledConnections.has(data.connectionId)) return get().refreshWorkbench();
        const saved = restored?.connectionId && restored.connectionId !== data.connectionId ? null : restored;
        const active = restore ? [] : get().jobs;
        const jobs = new Map(data.jobs.map((job) => [job.id, job]));
        for (const job of active) {
          if ((jobRevisions.get(job.id) ?? 0) > revision) jobs.set(job.id, job);
        }
        const logs = Object.fromEntries([...jobs.keys()].map((id) => [id, !restore && get().logs[id]?.length ? get().logs[id] : data.logs[id] ?? []]));
        for (const id of jobRevisions.keys()) if (!jobs.has(id)) jobRevisions.delete(id);
        set({
          jobs: [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt),
          logs,
          sessions: data.sessions,
          cachedScans: data.scans,
          connectionId: data.connectionId,
          initialized: true,
          workbenchError: null,
          ...(restore ? {
            view: get().initialized && get().view === 'settings' ? 'settings' as const : saved?.view && VIEWS.includes(saved.view as View) ? saved.view as View : saved?.selectedScanId ? 'results' as const : 'scan' as const,
            selectedScanId: saved?.selectedScanId ?? null,
            linkedFolder: saved?.linkedFolder ?? null,
            selectedSessionId: saved?.selectedSessionId ?? null,
            menuAction: null,
            workbenchTab: saved?.workbenchTab === 'decisions' ? 'decisions' as const : saved?.workbenchTab === 'activity' ? 'activity' as const : 'sessions' as const,
            batchId: data.jobs.find((job) => job.batchId)?.batchId ?? null
          } : {})
        });
      } catch (error) {
        if (request === workbenchRead) throw error;
      } finally {
        if (pendingWorkbench === pending) pendingWorkbench = null;
      }
    },

    applyEvent: (event) => {
      if (event.kind === 'job-updated') {
        const settled = Boolean(event.job.finishedAt) || ['completed', 'failed', 'canceled'].includes(event.job.progress.phase);
        if (!get().connectionId || event.job.connectionId !== get().connectionId) {
          if (settled && event.job.connectionId && pendingWorkbench?.request === workbenchRead) pendingWorkbench.settledConnections.add(event.job.connectionId);
          return;
        }
        jobRevisions.set(event.job.id, ++jobRevision);
        const jobs = [...get().jobs];
        const index = jobs.findIndex((job) => job.id === event.job.id);
        if (index >= 0) jobs[index] = event.job;
        else jobs.unshift(event.job);
        set(settled ? { jobs, historyVersion: get().historyVersion + 1 } : { jobs });
        if (settled) void get().refreshWorkbench().catch((error) => set({ workbenchError: error instanceof Error ? error.message : String(error) }));
      } else if (event.kind === 'job-list') {
        const jobs = event.jobs.filter((job) => get().connectionId && job.connectionId === get().connectionId);
        if (!jobs.length) return;
        for (const job of jobs) jobRevisions.set(job.id, ++jobRevision);
        const incoming = new Set(jobs.map((job) => job.id));
        set({ batchId: jobs[0]?.batchId ?? null, jobs: [...jobs, ...get().jobs.filter((job) => !incoming.has(job.id))] });
      } else if (event.kind === 'log') {
        if (!get().jobs.some((job) => job.id === event.jobId && job.connectionId === get().connectionId)) return;
        set((state) => ({ logs: { ...state.logs, [event.jobId]: [...(state.logs[event.jobId] ?? []), event.line].slice(-400) } }));
      }
    },

    setSelectedScan: (selectedScanId, folder, autoBaseline) => {
      set((state) => ({
        selectedScanId,
        linkedFolder: folder === undefined ? selectedScanId === state.selectedScanId ? state.linkedFolder : null : folder,
        pendingAutoBaseline: autoBaseline ?? false
      }));
      persist();
    },
    clearAutoBaseline: () => set({ pendingAutoBaseline: false }),
    triggerMenuAction: (action) => set((state) => ({ menuAction: action, menuActionId: state.menuActionId + 1 }))
  };
});
