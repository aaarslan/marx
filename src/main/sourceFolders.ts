import fs from 'node:fs';
import fsp from 'node:fs/promises';

export class SourceFolders {
  private readonly roots = new Set<string>();

  constructor(recentFolders: string[] = []) {
    for (const folder of recentFolders) {
      try {
        const root = fs.realpathSync(folder);
        if (fs.statSync(root).isDirectory()) this.roots.add(root);
      } catch {}
    }
  }

  async grant(folder: string): Promise<string> {
    const root = await fsp.realpath(folder);
    if (!(await fsp.stat(root)).isDirectory()) throw new Error('Choose a project folder, not a file.');
    this.roots.add(root);
    return root;
  }

  async require(folder: string): Promise<string> {
    const root = await fsp.realpath(folder);
    if (!this.roots.has(root)) throw new Error('Choose this folder in Marx before accessing its source.');
    return root;
  }
}
