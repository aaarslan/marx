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
    view: state.view,
    selectedScanId: state.selectedScanId,
    linkedFolder: state.linkedFolder,
    selectedSessionId: state.selectedSessionId ?? undefined,
    workbenchTab: state.workbenchTab
  };
}

export const useApp = create<AppState>((set, get) => {
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
          catch (error) { set({ workbenchError: `Could not save workspace: ${error instanceof Error ? error.message : String(error)}` }); }
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
      if (!subscribed) {
        subscribed = true;
        api.onScanEvent((event) => get().applyEvent(event));
      }
      try {
        const settings = await api.settings.get();
        set({ settings });
        await get().refreshWorkbench();
      } catch (error) {
        set({ workbenchError: error instanceof Error ? error.message : String(error), initialized: true });
      }
    },

    refreshWorkbench: async () => {
      const data = await api.workbench.bootstrap();
      const restore = !get().initialized || data.connectionId !== get().connectionId;
      const saved = restore ? await api.workbench.workspace('navigation') : null;
      const active = restore ? [] : get().jobs;
      const jobs = new Map(data.jobs.map((job) => [job.id, job]));
      for (const job of active) {
        const stored = jobs.get(job.id);
        if (!stored || (!job.finishedAt && stored.finishedAt === undefined)) jobs.set(job.id, job);
      }
      set({
        jobs: [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt),
        logs: restore ? data.logs : { ...data.logs, ...get().logs },
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
          workbenchTab: saved?.workbenchTab === 'decisions' ? 'decisions' as const : saved?.workbenchTab === 'activity' ? 'activity' as const : 'sessions' as const,
          batchId: data.jobs.find((job) => job.batchId)?.batchId ?? null
        } : {})
      });
    },

    applyEvent: (event) => {
      if (event.kind === 'job-updated') {
        const jobs = [...get().jobs];
        const index = jobs.findIndex((job) => job.id === event.job.id);
        if (index >= 0) jobs[index] = event.job;
        else jobs.unshift(event.job);
        const settled = Boolean(event.job.finishedAt) || ['completed', 'failed', 'canceled'].includes(event.job.progress.phase);
        set(settled ? { jobs, historyVersion: get().historyVersion + 1 } : { jobs });
        if (settled) void get().refreshWorkbench().catch((error) => set({ workbenchError: error instanceof Error ? error.message : String(error) }));
      } else if (event.kind === 'job-list') {
        const incoming = new Set(event.jobs.map((job) => job.id));
        set({ batchId: event.jobs[0]?.batchId ?? null, jobs: [...event.jobs, ...get().jobs.filter((job) => !incoming.has(job.id))] });
      } else if (event.kind === 'log') {
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
