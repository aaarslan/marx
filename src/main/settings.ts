import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, type Settings } from '@shared/types';

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const keyFile = () => path.join(app.getPath('userData'), 'settings.key');
let cache: Settings | null = null;

export function protectedStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend?.() !== 'basic_text');
}

function credentialStatus() {
  const available = protectedStorageAvailable();
  let stored = false;
  try { stored = fs.statSync(keyFile()).size > 0; } catch {}
  return { credentialStorageAvailable: available, hasStoredApiKey: stored, hasApiKey: available && stored };
}

function writePrivate(file: string, contents: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

export function loadSettings(): Settings {
  if (!cache) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<Settings>;
      cache = { ...DEFAULT_SETTINGS, ...parsed, defaults: { ...DEFAULT_SETTINGS.defaults, ...(parsed.defaults ?? {}) } };
    } catch { cache = { ...DEFAULT_SETTINGS, defaults: { ...DEFAULT_SETTINGS.defaults } }; }
  }
  return { ...cache, ...credentialStatus() };
}

export function saveSettings(next: Partial<Settings>): Settings {
  const current = loadSettings();
  const updated = { ...current, ...next, defaults: { ...current.defaults, ...(next.defaults ?? {}) }, ...credentialStatus() };
  writePrivate(settingsFile(), JSON.stringify(updated, null, 2));
  cache = updated;
  return loadSettings();
}

export function getApiKey(): string | null {
  let blob: Buffer;
  try { blob = fs.readFileSync(keyFile()); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('The saved API key cannot be read. Use the CLI’s existing configuration or replace the saved key in Settings.');
  }
  if (!blob.length) return null;
  if (!protectedStorageAvailable()) throw new Error('Protected credential storage is unavailable. Use the CLI’s existing configuration; Marx will not read an unprotected API key.');
  try { return safeStorage.decryptString(blob); } catch {
    throw new Error('The saved API key cannot be decrypted with protected storage. A legacy plaintext or unreadable key must be replaced in Settings, or use the CLI’s existing configuration. The existing file was left unchanged.');
  }
}

export function setApiKey(key: string): void {
  if (typeof key !== 'string') throw new Error('Enter a valid API key.');
  if (!key) {
    writePrivate(keyFile(), Buffer.alloc(0));
    saveSettings({ hasApiKey: false });
    return;
  }
  if (!protectedStorageAvailable()) throw new Error('Protected credential storage is unavailable. Marx will not save an API key as plaintext. Use the CLI’s existing configuration instead.');
  const encrypted = safeStorage.encryptString(key);
  if (!encrypted.length) throw new Error('The API key could not be encrypted. The existing key was left unchanged.');
  writePrivate(keyFile(), encrypted);
  saveSettings({ hasApiKey: true });
}
