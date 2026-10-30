import { create } from 'zustand';
import type { ScanEvent, ScanJobState, Settings } from '@shared/types';
import type { MenuAction } from '@shared/ipc';
import { api } from './api';

export type View = 'scan' | 'batch' | 'results' | 'history' | 'settings';

interface AppState {
  view: View;
  settings: Settings | null;
  jobs: ScanJobState[];
  batchId: string | null;
  logs: Record<string, string[]>;
  /** scan to open in the Results view */
  selectedScanId: string | null;
  /** local folder linked to the selected scan (for code snippets) */
  linkedFolder: string | null;
  /** menu-driven actions (⌘R / ⌘O), consumed by the Scan view */
  menuAction: MenuAction | null;
  menuActionId: number;
  /** bumped whenever a job settles, so history views can refetch */
  historyVersion: number;
  pendingAutoBaseline: boolean;

  setView: (v: View) => void;
  init: () => Promise<void>;
  applyEvent: (e: ScanEvent) => void;
  setSelectedScan: (scanId: string | null, folder?: string | null, autoBaseline?: boolean) => void;
  clearAutoBaseline: () => void;
  triggerMenuAction: (action: MenuAction) => void;
}

let subscribed = false;

export const useApp = create<AppState>((set, get) => ({
  view: 'scan',
  settings: null,
  jobs: [],
  batchId: null,
  logs: {},
  selectedScanId: null,
  linkedFolder: null,
  menuAction: null,
  menuActionId: 0,
  historyVersion: 0,
  pendingAutoBaseline: false,

  setView: (v) => set({ view: v }),

  init: async () => {
    if (!subscribed) {
      subscribed = true;
      api.onScanEvent((event) => get().applyEvent(event));
    }
    try {
      const settings = await api.settings.get();
      set({ settings });
    } catch {
      /* first run */
    }
  },

  applyEvent: (e) => {
    if (e.kind === 'job-updated') {
      const jobs = [...get().jobs];
      const idx = jobs.findIndex((j) => j.id === e.job.id);
      if (idx >= 0) jobs[idx] = e.job;
      else jobs.unshift(e.job);
      const settled =
        e.job.progress.phase === 'completed' ||
        e.job.progress.phase === 'failed' ||
        e.job.progress.phase === 'canceled';
      set(settled ? { jobs, historyVersion: get().historyVersion + 1 } : { jobs });
    } else if (e.kind === 'job-list') {
      const incoming = new Map(e.jobs.map((j) => [j.id, j]));
      set({ batchId: e.jobs[0]?.batchId ?? null, jobs: [...e.jobs, ...get().jobs.filter((j) => !incoming.has(j.id))] });
    } else if (e.kind === 'log') {
      const logs = { ...get().logs };
      logs[e.jobId] = [...(logs[e.jobId] ?? []), e.line].slice(-200);
      set({ logs });
    } else if (e.kind === 'open-results') {
      set((s) => ({
        selectedScanId: e.scanId,
        linkedFolder: e.folderPath ?? s.linkedFolder,
        view: 'results'
      }));
    }
  },

  setSelectedScan: (scanId, folder, autoBaseline) =>
    set((s) => ({
      selectedScanId: scanId,
      linkedFolder: folder === undefined ? (scanId === s.selectedScanId ? s.linkedFolder : null) : folder,
      pendingAutoBaseline: autoBaseline ?? false
    })),

  clearAutoBaseline: () => set({ pendingAutoBaseline: false }),

  triggerMenuAction: (action) =>
    set((s) => ({ menuAction: action, menuActionId: s.menuActionId + 1 }))
}));
