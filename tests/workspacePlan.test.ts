import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverWorkspace, planWorkspace } from '../src/main/workspacePlan';

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
function root() { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-workspace-')); folders.push(folder); return folder; }
function write(folder: string, file: string, content: string) { const target = path.join(folder, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
function pkg(folder: string, relative: string, name: string, dependencies: Record<string, string> = {}) { write(folder, `${relative}/package.json`, JSON.stringify({ name, dependencies })); }
function git(folder: string, ...args: string[]) { return execFileSync('git', ['-C', folder, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: 'pipe' }); }

describe('workspace plans', () => {
  it('discovers declared nested workspaces, excludes noise and preserves separate package identities', () => {
    const folder = root();
    write(folder, 'package.json', JSON.stringify({ workspaces: { packages: ['apps/*', 'packages/**', '!packages/skip', '../outside'] } }));
    pkg(folder, 'apps/web', '@app/web', { '@app/shared': 'workspace:*' });
    pkg(folder, 'packages/nested/shared', '@app/shared');
    pkg(folder, 'packages/skip', 'skip');
    pkg(folder, 'node_modules/fake', 'fake');
    write(folder, 'service/pyproject.toml', '[project]');
    const outside = root();
    pkg(outside, 'escape', 'escape');
    fs.symlinkSync(path.join(outside, 'escape'), path.join(folder, 'apps/linked'), 'dir');
    const plan = discoverWorkspace(folder);
    expect(plan.projects.map((item) => item.relativePath)).toEqual(['apps/web', 'packages/nested/shared', 'service']);
    expect(plan.projects[0].dependencies).toEqual(['@app/shared']);
    expect(plan.warnings.some((warning) => warning.includes('../outside'))).toBe(true);
    expect(plan.sharedFiles).toContain('package.json');
  });

  it('reads pnpm block-list packages and tolerates invalid optional JSON manifests', () => {
    const folder = root();
    write(folder, 'package.json', 'null');
    write(folder, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - \"packages/*\" # packages\n  - '!packages/private'\nonlyBuiltDependencies:\n  - esbuild\n");
    pkg(folder, 'apps/one', 'one');
    pkg(folder, 'packages/two', 'two');
    pkg(folder, 'packages/private', 'private');
    expect(discoverWorkspace(folder).projects.map((item) => item.name)).toEqual(['one', 'two']);
  });

  it('marks changed packages and transitive dependents, then all projects for shared changes', async () => {
    const folder = root();
    write(folder, 'package.json', JSON.stringify({ workspaces: ['packages/*'] }));
    pkg(folder, 'packages/core', 'core');
    pkg(folder, 'packages/ui', 'ui', { core: 'workspace:*' });
    pkg(folder, 'packages/app', 'app', { ui: 'workspace:*' });
    pkg(folder, 'packages/unrelated', 'unrelated');
    write(folder, 'packages/core/index.ts', 'export const value = 1;');
    git(folder, 'init', '--initial-branch=main'); git(folder, 'add', '.'); git(folder, 'commit', '-m', 'fixture');
    write(folder, 'packages/core/index.ts', 'export const value = 2;');
    const changed = await planWorkspace(folder);
    expect(changed.impactAvailable).toBe(true);
    expect(changed.projects.filter((item) => item.affected).map((item) => item.name).sort()).toEqual(['app', 'core', 'ui']);
    write(folder, 'pnpm-lock.yaml', 'lockfileVersion: 9');
    const shared = await planWorkspace(folder);
    expect(shared.projects.every((item) => item.affected)).toBe(true);
    expect(shared.changedFiles).toContain('pnpm-lock.yaml');
  });

  it('includes both source and destination packages for a staged cross-package rename', async () => {
    const folder = root();
    write(folder, 'package.json', JSON.stringify({ workspaces: ['packages/*'] }));
    pkg(folder, 'packages/left', 'left'); pkg(folder, 'packages/right', 'right');
    write(folder, 'packages/left/source.ts', 'export const value = 1;');
    git(folder, 'init', '--initial-branch=main'); git(folder, 'add', '.'); git(folder, 'commit', '-m', 'fixture');
    git(folder, 'mv', 'packages/left/source.ts', 'packages/right/source.ts');
    const plan = await planWorkspace(folder);
    expect(plan.projects.every((item) => item.affected)).toBe(true);
    expect(plan.changedFiles).toContain('packages/left/source.ts');
    expect(plan.changedFiles).toContain('packages/right/source.ts');
  });

  it('does not claim change impact for folders outside a Git checkout', async () => {
    const folder = root(); pkg(folder, 'project', 'project');
    const plan = await planWorkspace(folder);
    expect(plan.impactAvailable).toBe(false);
    expect(plan.warnings.join(' ')).toContain('unavailable');
  });
});
