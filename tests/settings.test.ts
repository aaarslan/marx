import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ folder: '', encrypted: true, failEncryption: false, decryptCalls: 0 }));
vi.mock('electron', () => ({
  app: { getPath: () => state.folder },
  safeStorage: {
    isEncryptionAvailable: () => state.encrypted,
    encryptString: (s: string) => { if (state.failEncryption) throw new Error('Unavailable'); return Buffer.from(`encrypted:${s}`); },
    decryptString: (b: Buffer) => { state.decryptCalls++; if (!b.toString().startsWith('encrypted:')) throw new Error('Not encrypted'); return b.toString().slice(10); }
  }
}));
beforeEach(() => {
  vi.resetModules();
  state.folder = fs.mkdtempSync(path.join(os.tmpdir(), 'marx-settings-'));
  state.encrypted = true; state.failEncryption = false; state.decryptCalls = 0;
});
afterEach(() => { fs.rmSync(state.folder, { recursive: true, force: true }); });
const keyFile = () => path.join(state.folder, 'settings.key');

describe('credential and settings persistence', () => {
  it('persists encrypted credentials and settings privately across restart', async () => {
    const settings = await import('../src/main/settings');
    settings.setApiKey('synthetic-key');
    expect(settings.getApiKey()).toBe('synthetic-key');
    expect(fs.statSync(keyFile()).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(state.folder, 'settings.json')).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(keyFile(), 'utf8')).toBe('encrypted:synthetic-key');
    settings.saveSettings({ recentFolders: ['/tmp/fixture'] });
    vi.resetModules();
    const reloaded = await import('../src/main/settings');
    expect(reloaded.loadSettings().recentFolders).toEqual(['/tmp/fixture']);
    expect(reloaded.getApiKey()).toBe('synthetic-key');
    reloaded.setApiKey('');
    expect(reloaded.getApiKey()).toBeNull();
    expect(reloaded.loadSettings().hasStoredApiKey).toBe(false);
  });

  it('does not write or decrypt keys without protected storage', async () => {
    state.encrypted = false;
    const settings = await import('../src/main/settings');
    expect(() => settings.setApiKey('synthetic')).toThrow('will not save');
    expect(fs.existsSync(keyFile())).toBe(false);
    fs.writeFileSync(keyFile(), 'legacy-key');
    expect(() => settings.getApiKey()).toThrow('unavailable');
    expect(state.decryptCalls).toBe(0);
    expect(fs.readFileSync(keyFile(), 'utf8')).toBe('legacy-key');
    expect(settings.loadSettings()).toMatchObject({ hasApiKey: false, hasStoredApiKey: true, credentialStorageAvailable: false });
  });

  it('blocks legacy plaintext without deleting or migrating it', async () => {
    fs.writeFileSync(keyFile(), 'legacy-key');
    const settings = await import('../src/main/settings');
    expect(() => settings.getApiKey()).toThrow('legacy plaintext');
    expect(fs.readFileSync(keyFile(), 'utf8')).toBe('legacy-key');
    settings.setApiKey('replacement');
    expect(settings.getApiKey()).toBe('replacement');
  });

  it('preserves the existing key on encryption failure and permits explicit removal', async () => {
    fs.writeFileSync(keyFile(), 'encrypted:original');
    state.failEncryption = true;
    const settings = await import('../src/main/settings');
    expect(() => settings.setApiKey('replacement')).toThrow();
    expect(fs.readFileSync(keyFile(), 'utf8')).toBe('encrypted:original');
    state.encrypted = false;
    settings.setApiKey('');
    expect(settings.getApiKey()).toBeNull();
  });

  it('refreshes protection availability without prompting for decryption', async () => {
    fs.writeFileSync(keyFile(), 'encrypted:original');
    const settings = await import('../src/main/settings');
    expect(settings.loadSettings().credentialStorageAvailable).toBe(true);
    state.encrypted = false;
    expect(settings.loadSettings().credentialStorageAvailable).toBe(false);
    expect(state.decryptCalls).toBe(0);
  });
});
