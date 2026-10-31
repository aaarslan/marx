import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitInfo } from '@shared/types';
import { discoverWorkspace } from './workspacePlan';

const exec = promisify(execFile);

export async function getGitInfo(folder: string): Promise<GitInfo> {
  const repoName = path.basename(folder);
  try {
    const { stdout } = await exec('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd: folder,
      timeout: 5000
    });
    return { branch: stdout.trim() || 'master', repoName, hasGit: true };
  } catch (error) {
    if ((error as { code?: number }).code === 1) return { branch: 'HEAD', repoName, hasGit: true };
    // not a git repo (or git missing)
    return { branch: 'master', repoName, hasGit: false };
  }
}

export function listSubProjects(parent: string): string[] {
  try {
    return discoverWorkspace(parent).projects.map((item) => item.folderPath);
  } catch {
    return [];
  }
}
