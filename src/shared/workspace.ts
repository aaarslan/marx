export interface WorkspaceProject {
  folderPath: string;
  relativePath: string;
  name: string;
  dependencies: string[];
  affected: boolean;
  reasons: string[];
}

export interface WorkspacePlan {
  rootPath: string;
  projects: WorkspaceProject[];
  sharedFiles: string[];
  changedFiles: string[];
  impactAvailable: boolean;
  warnings: string[];
}
