import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCliJson, redactCliOutput, resolveCli, runCliProcess } from '../src/main/cliProcess';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => fs.rm(folder, { recursive: true, force: true }))); });
const execute = (script: string, options: Partial<Parameters<typeof runCliProcess>[0]> = {}) => runCliProcess({ executable: process.execPath, args: ['-e', script], ...options });

describe('CLI process boundary', () => {
  it('passes literal arguments without shell expansion and drains both streams', async () => {
    const lines: string[] = [];
    const text = await runCliProcess({ executable: process.execPath, args: ['-e', 'console.error("progress"); console.log(JSON.stringify(process.argv.slice(1)))', '--', '$(never-run)', 'folder with spaces', '--flag=value'], onLine: (line) => lines.push(line) });
    expect(JSON.parse(text)).toEqual(['$(never-run)', 'folder with spaces', '--flag=value']);
    expect(lines).toContain('progress');
  });

  it('redacts secrets across data chunks and propagates nonzero exits', async () => {
    const lines: string[] = [];
    await expect(execute('process.stderr.write("fake-"); setTimeout(() => { process.stderr.write("api-key\\n"); process.exit(7); }, 10)', { env: { ...process.env, CX_APIKEY: 'fake-api-key' }, onLine: (line) => lines.push(line) })).rejects.toThrow('exited with 7: [redacted]');
    expect(lines).toEqual(['[redacted]']);
    expect(redactCliOutput('https://u:p@proxy/path?X-Amz-Signature=private&x=y', {})).toBe('https://[redacted]@proxy/path?X-Amz-Signature=[redacted]&x=y');
  });

  it('terminates stalled and canceled children', async () => {
    await expect(execute('setInterval(() => {}, 100)', { timeoutMs: 30 })).rejects.toThrow('timed out');
    const controller = new AbortController();
    const pending = execute('setInterval(() => {}, 100)', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('canceled');
    await expect(execute('throw new Error("must not run")', { signal: controller.signal })).rejects.toThrow();
  });

  it('bounds captured output and reports a missing executable', async () => {
    await expect(execute('console.log("x".repeat(2000))', { maxOutputBytes: 100 })).rejects.toThrow('safety limit');
    await expect(runCliProcess({ executable: '/nonexistent/marx-cx', args: [] })).rejects.toThrow('Could not start');
  });

  it('only discovers absolute executable paths and preserves a configured failure', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'marx-cli-path-'));
    folders.push(folder);
    const executable = path.join(folder, process.platform === 'win32' ? 'cx.exe' : 'cx');
    await fs.writeFile(executable, '', { mode: 0o700 });
    expect(await resolveCli('', { PATH: `.${path.delimiter}${folder}` })).toBe(executable);
    await expect(resolveCli('cx')).rejects.toThrow('absolute path');
    await expect(resolveCli(path.join(folder, 'missing'), { PATH: folder })).rejects.toThrow('selected Checkmarx CLI');
  });

  it('parses CLI JSON mixed with diagnostics and rejects unsupported output', () => {
    expect(parseCliJson('preparing\n{"ID":"s1","text":"brace } inside string"}\nScan created')).toMatchObject({ ID: 's1' });
    expect(parseCliJson('[]')).toEqual([]);
    expect(() => parseCliJson('CLI produced text only')).toThrow('valid JSON');
  });
});
