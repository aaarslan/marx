import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import picomatch from 'picomatch';
import type { WorkspacePlan, WorkspaceProject } from '@shared/workspace';

const exec = promisify(execFile);
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', 'target', 'vendor']);
const MARKERS = new Set(['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'go.mod', 'Cargo.toml', 'requirements.txt', 'pyproject.toml', 'Gemfile', 'composer.json', 'pubspec.yaml', 'Makefile']);
const SHARED = ['package.json', 'package-lock.json', 'bun.lock', 'bun.lockb', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'Cargo.lock', 'go.work'];
const MAX_DIRECTORIES = 2000;
const MAX_ENTRIES = 40_000;
const MAX_PROJECTS = 1000;
const MAX_PATTERNS = 200;
const MAX_SELECTORS = 1000;
const MAX_DEPTH = 8;

function readSmall(file: string): string | null {
  let handle: number | undefined;
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return null;
    handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(handle);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = fs.readSync(handle, buffer, size, buffer.length - size, null);
      if (!read) break;
      size += read;
    }
    return size === stat.size ? buffer.subarray(0, size).toString('utf8') : null;
  } catch { return null; }
  finally { if (handle !== undefined) fs.closeSync(handle); }
}

function manifest(folder: string): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(readSmall(path.join(folder, 'package.json')) ?? '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  }
  catch { return {}; }
}

function patterns(root: string, warnings: string[]): string[] {
  const data = manifest(root);
  const workspaces = Array.isArray(data.workspaces) ? data.workspaces : (data.workspaces as { packages?: unknown } | undefined)?.packages;
  const found = Array.isArray(workspaces) ? workspaces.filter((item): item is string => typeof item === 'string') : [];
  const pnpm = readSmall(path.join(root, 'pnpm-workspace.yaml'));
  if (pnpm) {
    let inPackages = false;
    for (const line of pnpm.split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) {
        inPackages = true;
        if (line.replace(/#.*$/, '').split(':').slice(1).join(':').trim()) warnings.push('Use a block list for pnpm packages; inline YAML workspace lists are not interpreted.');
        continue;
      }
      if (inPackages && /^[^\s#]/.test(line)) inPackages = false;
      if (!inPackages || !line.trim() || line.trimStart().startsWith('#')) continue;
      const match = line.match(/^\s*-\s*(?:'([^']*)'|"([^"]*)"|([^#]*?))\s*(?:#.*)?$/);
      if (match) found.push((match[1] ?? match[2] ?? match[3]).trim());
      else warnings.push('A pnpm workspace entry could not be interpreted. Review the discovered folders.');
      if (found.length > MAX_PATTERNS) break;
    }
  }
  if (found.length > MAX_PATTERNS) warnings.push('Only the first 200 workspace patterns were interpreted. Review missing packages manually.');
  return [...new Set(found.slice(0, MAX_PATTERNS))];
}

function expand(pattern: string, warnings: string[]): string[] {
  const pending = [pattern];
  const result: string[] = [];
  let steps = 0;
  let limited = false;
  while (pending.length && steps++ < 1000 && result.length < 100) {
    const current = pending.shift()!;
    const braces = current.match(/\{([^{}]+)\}/);
    if (!braces) { result.push(current); continue; }
    const values = braces[1].split(',');
    if (values.length > 20) { limited = true; continue; }
    for (const value of values) {
      if (pending.length + result.length >= 100) { limited = true; break; }
      pending.push(current.replace(braces[0], value));
    }
  }
  if (limited || pending.length) warnings.push('Workspace brace expansion reached its 100-pattern limit. Review missing packages manually.');
  return result;
}

function contained(root: string, folder: string): string | null {
  try {
    const canonical = fs.realpathSync(folder);
    const relative = path.relative(root, canonical);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? canonical : null;
  } catch { return null; }
}

export function discoverWorkspace(root: string): WorkspacePlan {
  const rootPath = fs.realpathSync(root);
  const warnings: string[] = [];
  const selectors: { exclude: boolean; matches: (value: string) => boolean }[] = [];
  for (const entry of patterns(rootPath, warnings)) {
    const exclude = entry.startsWith('!');
    const value = (exclude ? entry.slice(1) : entry).replace(/^\.\//, '').replace(/\/$/, '');
    if (!value || value.length > 512 || path.isAbsolute(value) || value.split('/').includes('..') || /[\\[\]()]/.test(value)) {
      warnings.push(`Unsupported workspace pattern: ${entry.slice(0, 100)}`);
      continue;
    }
    for (const item of expand(value, warnings)) {
      if (selectors.length >= MAX_SELECTORS) break;
      selectors.push({ exclude, matches: picomatch(item, { nonegate: true, windows: false, strictSlashes: true }) });
    }
    if (selectors.length >= MAX_SELECTORS) { warnings.push('Discovery reached its 1,000 expanded-pattern limit. Review missing packages manually.'); break; }
  }
  const folders = new Set<string>();
  const visited = new Set<string>();
  const pending = [{ folder: rootPath, depth: 0 }];
  let entriesRead = 0;
  let depthLimited = false;
  let queueLimited = false;
  while (pending.length && visited.size < MAX_DIRECTORIES && entriesRead < MAX_ENTRIES && folders.size < MAX_PROJECTS) {
    const current = pending.shift()!;
    const canonical = contained(rootPath, current.folder);
    if (!canonical || canonical !== current.folder || visited.has(canonical)) continue;
    visited.add(canonical);
    const entries: fs.Dirent[] = [];
    let directory: fs.Dir | undefined;
    try {
      directory = fs.opendirSync(canonical);
      while (entriesRead < MAX_ENTRIES) {
        const entry = directory.readSync();
        if (!entry) break;
        entriesRead++;
        entries.push(entry);
      }
    } catch { warnings.push('Some workspace directories could not be read. Review the discovered folders.'); }
    finally { directory?.closeSync(); }
    const relative = path.relative(rootPath, canonical).split(path.sep).join('/');
    const included = selectors.some((selector) => !selector.exclude && selector.matches(relative));
    const excluded = selectors.some((selector) => selector.exclude && selector.matches(relative));
    const isProject = entries.some((entry) => (entry.isFile() && (MARKERS.has(entry.name) || entry.name.endsWith('.csproj'))) || (entry.name === '.git' && !entry.isSymbolicLink() && (entry.isFile() || entry.isDirectory())));
    if (current.depth > 0 && !excluded && (included || current.depth === 1) && isProject) folders.add(canonical);
    if (current.depth > 0 && !selectors.length) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      if (current.depth >= MAX_DEPTH) { depthLimited = true; continue; }
      if (visited.size + pending.length >= MAX_DIRECTORIES) { queueLimited = true; break; }
      const folder = contained(rootPath, path.join(canonical, entry.name));
      if (folder && folder !== rootPath && !visited.has(folder)) pending.push({ folder, depth: current.depth + 1 });
    }
  }
  if (queueLimited || (pending.length && visited.size >= MAX_DIRECTORIES)) warnings.push('Discovery stopped after 2,000 directories. Review the plan for missing workspaces.');
  if (entriesRead >= MAX_ENTRIES) warnings.push('Discovery stopped after 40,000 directory entries. Review the plan for missing workspaces.');
  if (folders.size >= MAX_PROJECTS) warnings.push('Discovery stopped after 1,000 projects. Review the plan for missing workspaces.');
  if (depthLimited) warnings.push('Workspace nesting beyond eight levels was not explored. Review deeper packages manually.');
  const projects: WorkspaceProject[] = [...folders].sort().map((folderPath) => {
    const data = manifest(folderPath);
    const dependencies = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((key) => {
      const values = data[key];
      return values && typeof values === 'object' && !Array.isArray(values) ? Object.keys(values) : [];
    });
    return { folderPath, relativePath: path.relative(rootPath, folderPath).split(path.sep).join('/'), name: typeof data.name === 'string' ? data.name : path.basename(folderPath), dependencies: [...new Set(dependencies)], affected: false, reasons: [] };
  });
  const names = new Set(projects.map((item) => item.name));
  for (const item of projects) item.dependencies = item.dependencies.filter((name) => names.has(name) && name !== item.name);
  if (names.size !== projects.length) warnings.push('Duplicate package names were found; dependency impact is conservative.');
  return { rootPath, projects, sharedFiles: SHARED.filter((file) => fs.existsSync(path.join(rootPath, file))), changedFiles: [], impactAvailable: false, warnings: [...new Set(warnings)] };
}

export async function planWorkspace(root: string): Promise<WorkspacePlan> {
  const plan = discoverWorkspace(root);
  try {
    const options = { cwd: plan.rootPath, timeout: 5000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' as const };
    const results = await Promise.all([
      exec('git', ['-c', 'core.fsmonitor=false', 'diff', '--no-renames', '--name-only', '--relative', '-z', 'HEAD', '--', '.'], options),
      exec('git', ['-c', 'core.fsmonitor=false', 'ls-files', '--others', '--exclude-standard', '-z', '--', '.'], options)
    ]);
    plan.changedFiles = [...new Set(results.flatMap((result) => result.stdout.split('\0').filter(Boolean)))];
    plan.impactAvailable = true;
  } catch {
    plan.warnings.push('Change impact is unavailable. Use a Git checkout with an initial commit, and review every project.');
    return plan;
  }
  const sharedChanges = plan.changedFiles.filter((file) => !plan.projects.some((item) => file.startsWith(`${item.relativePath}/`)));
  for (const item of plan.projects) {
    const direct = plan.changedFiles.some((file) => file.startsWith(`${item.relativePath}/`));
    if (direct) item.reasons.push('Uncommitted files changed');
    if (sharedChanges.length) item.reasons.push('Root or shared files changed');
    item.affected = item.reasons.length > 0;
  }
  let changed = true;
  while (changed) {
    changed = false;
    const affected = new Set(plan.projects.filter((item) => item.affected).map((item) => item.name));
    for (const item of plan.projects) {
      if (item.affected) continue;
      const dependency = item.dependencies.find((name) => affected.has(name));
      if (dependency) { item.affected = true; item.reasons.push(`Depends on changed package ${dependency}`); changed = true; }
    }
  }
  return plan;
}
