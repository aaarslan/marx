import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { folderName } from '../src/shared/path';

const afterPack = createRequire(import.meta.url)('../scripts/after-pack.cjs') as (context: { electronPlatformName: string }) => Promise<void>;

describe('cross-platform distribution', () => {
  it('displays POSIX, drive and UNC folder names without leaking the full path', () => {
    expect(folderName('/projects/frontend/')).toBe('frontend');
    expect(folderName('C:\\Projects\\Frontend\\')).toBe('Frontend');
    expect(folderName('\\\\server\\projects\\frontend')).toBe('frontend');
    expect(folderName('C:/Projects/Frontend')).toBe('Frontend');
    expect(folderName('/')).toBe('/');
  });

  it('never runs the macOS signing hook for Windows packaging', async () => {
    await expect(afterPack({ electronPlatformName: 'win32' })).resolves.toBeUndefined();
  });

  it('ships a structurally valid Windows icon with a 256px PNG frame', () => {
    const icon = fs.readFileSync(new URL('../build/icon.ico', import.meta.url));
    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    expect(icon.readUInt16LE(4)).toBe(1);
    const offset = icon.readUInt32LE(18);
    expect(offset + icon.readUInt32LE(14)).toBe(icon.length);
    expect(icon.subarray(offset, offset + 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(icon.readUInt32BE(offset + 16)).toBe(256);
    expect(icon.readUInt32BE(offset + 20)).toBe(256);
  });
});
