import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitInfo } from '@shared/types';

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

const PROJECT_MARKERS = [
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'go.mod',
  'Cargo.toml',
  'requirements.txt',
  'pyproject.toml',
  'Gemfile',
  'composer.json',
  '*.csproj',
  'pubspec.yaml',
  'Makefile',
  '.git'
];

function looksLikeProject(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir);
    return entries.some((e) =>
      PROJECT_MARKERS.some((m) =>
        m.startsWith('*') ? e.endsWith(m.slice(1)) : e === m
      )
    );
  } catch {
    return false;
  }
}

/** Immediate subfolders of `parent` that look like code projects. */
export function listSubProjects(parent: string): string[] {
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => path.join(parent, d.name))
      .filter(looksLikeProject)
      .sort();
  } catch {
    return [];
  }
}
