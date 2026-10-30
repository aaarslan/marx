import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ folder: '', encrypted: false }));
vi.mock('electron', () => ({
  app: { getPath: () => state.folder },
  safeStorage: {
    isEncryptionAvailable: () => state.encrypted,
    encryptString: (s: string) => Buffer.from(`encrypted:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^encrypted:/, '')
  }
}));
afterEach(() => { if (state.folder) fs.rmSync(state.folder, { recursive: true, force: true }); });

describe('credential and settings persistence', () => {
  it.each([false, true])('persists private settings and keys with encryption available=%s', async (encrypted) => {
    vi.resetModules();
    state.folder = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-settings-'));
    state.encrypted = encrypted;
    const settings = await import('../src/main/settings');
    settings.setApiKey('synthetic-key');
    expect(settings.getApiKey()).toBe('synthetic-key');
    const key = path.join(state.folder, 'settings.key');
    expect(fs.statSync(key).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(state.folder, 'settings.json')).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(key, 'utf8')).toBe(encrypted ? 'encrypted:synthetic-key' : 'synthetic-key');
    settings.saveSettings({ recentFolders: ['/tmp/fixture'] });
    vi.resetModules();
    const reloaded = await import('../src/main/settings');
    expect(reloaded.loadSettings().recentFolders).toEqual(['/tmp/fixture']);
    reloaded.setApiKey('');
    expect(reloaded.getApiKey()).toBeNull();
    expect(reloaded.loadSettings().hasApiKey).toBe(false);
  });
});
