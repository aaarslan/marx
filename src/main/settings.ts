import { app } from 'electron';
import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '@shared/types';

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');

let cache: Settings | null = null;

export function loadSettings(): Settings {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(SETTINGS_FILE(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    cache = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      defaults: { ...DEFAULT_SETTINGS.defaults, ...(parsed.defaults ?? {}) }
    };
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache!;
}

export function saveSettings(next: Partial<Settings>): Settings {
  const current = loadSettings();
  cache = {
    ...current,
    ...next,
    hasApiKey: getApiKey() !== null || Boolean(next.hasApiKey),
    defaults: { ...current.defaults, ...(next.defaults ?? {}) }
  };
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(cache, null, 2), { mode: 0o600 });
  fs.chmodSync(SETTINGS_FILE(), 0o600);
  return cache;
}

export function getApiKey(): string | null {
  try {
    const blob = fs.readFileSync(SETTINGS_FILE().replace('.json', '.key'), null);
    if (blob.length === 0) return null;
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(blob);
    }
    return blob.toString('utf-8');
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  const file = SETTINGS_FILE().replace('.json', '.key');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!key) {
    fs.writeFileSync(file, Buffer.alloc(0), { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    saveSettings({ hasApiKey: false });
    return;
  }
  const blob = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key)
    : Buffer.from(key, 'utf-8');
  fs.writeFileSync(file, blob, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  saveSettings({ hasApiKey: true });
}
