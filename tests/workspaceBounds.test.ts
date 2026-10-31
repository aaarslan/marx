import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverWorkspace } from '../src/main/workspacePlan';

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
const fixture = (workspaces: string[]) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-workspace-bounds-'));
  folders.push(folder);
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ workspaces }));
  fs.mkdirSync(path.join(folder, 'leaf'));
  fs.writeFileSync(path.join(folder, 'leaf', 'package.json'), '{"name":"leaf"}');
  return folder;
};

describe('workspace expansion budgets', () => {
  it('bounds combinatorial brace expansion and reports incomplete discovery', () => {
    const plan = discoverWorkspace(fixture(['{a,b,c,d,e,f,g,h,i,j}'.repeat(20)]));
    expect(plan.projects.map((item) => item.name)).toEqual(['leaf']);
    expect(plan.warnings.some((warning) => warning.includes('brace expansion'))).toBe(true);
  });

  it('bounds manifest pattern count and length', () => {
    const plan = discoverWorkspace(fixture(['x'.repeat(600), ...Array.from({ length: 201 }, (_, i) => `packages/${i}/*`)]));
    expect(plan.warnings.some((warning) => warning.includes('first 200'))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes('Unsupported workspace pattern'))).toBe(true);
  });
});
