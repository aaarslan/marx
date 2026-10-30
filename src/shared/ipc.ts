// IPC channel names shared between main and preload.

export const IPC = {
  // settings
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsSetApiKey: 'settings:set-api-key',
  testConnection: 'settings:test-connection',
  // dialogs / fs
  selectFolder: 'dialog:select-folder',
  selectCli: 'dialog:select-cli',
  readSourceFile: 'fs:read-source-file',
  authorizeFolder: 'fs:authorize-folder',
  gitInfo: 'git:info',
  listSubfolders: 'fs:list-subfolders',
  // projects
  projectsList: 'projects:list',
  // scans
  scanRun: 'scan:run',
  scanRunBatch: 'scan:run-batch',
  scanCancel: 'scan:cancel',
  scanCancelJob: 'scan:cancel-job',
  scanJobs: 'scan:jobs',
  scanHistory: 'scan:history',
  scanSummary: 'scan:summary',
  openExternal: 'shell:open-external',
  // results
  resultsGet: 'results:get',
  resultsTriage: 'results:triage',
  resultsExport: 'results:export',
  // push events
  scanEvent: 'scan:event',
  menuAction: 'menu:action'
} as const;

export type MenuAction = 'run-scan' | 'open-folder';
