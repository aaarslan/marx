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
  openInEditor: 'fs:open-in-editor',
  sourceStatus: 'fs:source-status',
  authorizeFolder: 'fs:authorize-folder',
  gitInfo: 'git:info',
  listSubfolders: 'fs:list-subfolders',
  workspacePlan: 'git:workspace-plan',
  // projects
  projectsList: 'projects:list',
  bindingGet: 'bindings:get',
  bindingSave: 'bindings:save',
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
  resultsCancel: 'results:cancel',
  resultsCompare: 'results:compare',
  resultsQuery: 'results:query',
  resultsSarif: 'results:sarif',
  resultsTriage: 'results:triage',
  resultsExport: 'results:export',
  remediationCopy: 'remediation:copy',
  remediationSave: 'remediation:save',
  workbenchBootstrap: 'workbench:bootstrap',
  sessionEvidence: 'session:evidence',
  workspaceGet: 'workspace:get',
  workspaceSave: 'workspace:save',
  sessionCreate: 'session:create',
  sessionUpdate: 'session:update',
  sessionDelete: 'session:delete',
  sessionVerify: 'session:verify',
  sessionRunVerification: 'session:run-verification',
  sessionExport: 'session:export',
  jobReconcile: 'job:reconcile',
  jobLogs: 'job:logs',
  snapshotDelete: 'snapshot:delete',
  workbenchPrune: 'workbench:prune',
  // push events
  scanEvent: 'scan:event',
  menuAction: 'menu:action'
} as const;

export type MenuAction = 'run-scan' | 'open-folder';
