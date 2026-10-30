import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StringDecoder } from 'node:string_decoder';

const activeProcesses = new Set<() => void>();

export class CliBusyError extends Error {
  constructor() {
    super('Checkmarx CLI is busy. Wait for an operation to finish and retry.');
    this.name = 'CliBusyError';
  }
}

export function stopCliProcesses(): void {
  for (const stop of activeProcesses) stop();
}

export interface CliProcessOptions {
  executable: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  onLine?: (line: string) => void;
}

export async function resolveCli(configured = '', env = process.env): Promise<string> {
  const name = process.platform === 'win32' ? 'cx.exe' : 'cx';
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  const candidates = configured.trim()
    ? [configured.trim()]
    : [...pathValue.split(path.delimiter), ...(process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : [])]
      .filter((entry) => path.isAbsolute(entry)).map((entry) => path.join(entry, name));
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) throw new Error('Choose an absolute path to the official Checkmarx CLI executable.');
    if (process.platform === 'win32' && path.extname(candidate).toLowerCase() !== '.exe') continue;
    try {
      if (!(await fs.stat(candidate)).isFile()) continue;
      await fs.access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(configured ? 'The selected Checkmarx CLI is missing or cannot be executed. Update its path in Settings.' : 'Checkmarx CLI (cx) was not found. Install your organization’s approved CLI and select its executable in Settings.');
}

export function redactCliOutput(text: string, env: NodeJS.ProcessEnv): string {
  let clean = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length >= 4 && /(?:APIKEY|API_KEY|TOKEN|SECRET|PASSWORD)/i.test(key)) clean = clean.split(value).join('[redacted]');
  }
  return clean
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:X-Amz-[\w-]+|X-Goog-[\w-]+|token|signature|sig|se|sp|sv)=)[^\s&"<>]+/gi, '$1[redacted]');
}

export function runCliProcess(options: CliProcessOptions): Promise<string> {
  const env = options.env ?? process.env;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason ?? new Error('CLI canceled')); return; }
    if (activeProcesses.size >= 12) { reject(new CliBusyError()); return; }
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd ?? os.homedir(), env, shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: Error) => {
      if (failure) return;
      failure = reason;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
    };
    const abort = () => stop(new Error('CLI canceled'));
    activeProcesses.add(abort);
    const timeout = setTimeout(() => stop(new Error('Checkmarx CLI timed out. Check Checkmarx One before retrying a submission.')), options.timeoutMs ?? 120_000);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const consume = (stream: NodeJS.ReadableStream, isError: boolean) => {
      const decoder = new StringDecoder('utf8');
      let pending = '';
      let droppingLine = false;
      const lines = (chunk: string) => {
        pending += chunk;
        let end: number;
        while ((end = pending.search(/[\r\n]/)) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!droppingLine && line) options.onLine?.(line.length > 16_384 ? '[CLI output line omitted: exceeds 16 KiB]' : redactCliOutput(line, env));
          droppingLine = false;
        }
        if (pending.length > 16_384) {
          if (!droppingLine) options.onLine?.('[CLI output line omitted: exceeds 16 KiB]');
          droppingLine = true;
          pending = '';
        }
      };
      stream.on('data', (buffer: Buffer) => {
        outputBytes += buffer.length;
        if (outputBytes > (options.maxOutputBytes ?? 32 * 1024 * 1024)) {
          stop(new Error('Checkmarx CLI output exceeded the safety limit. Narrow the query and retry.'));
          return;
        }
        const text = decoder.write(buffer);
        if (isError) stderr = (stderr + text).slice(-8192);
        else stdout += text;
        lines(text);
      });
      stream.on('end', () => { lines(decoder.end()); if (pending && !droppingLine) options.onLine?.(redactCliOutput(pending, env)); });
    };
    consume(child.stdout, false);
    consume(child.stderr, true);
    const cleanup = () => { activeProcesses.delete(abort); clearTimeout(timeout); clearTimeout(killTimer); options.signal?.removeEventListener('abort', abort); };
    child.on('error', (error) => { cleanup(); reject(new Error(redactCliOutput(`Could not start Checkmarx CLI: ${error.message}`, env))); });
    child.on('close', (code, signal) => {
      cleanup();
      if (failure) { reject(failure); return; }
      if (code !== 0) {
        reject(new Error(redactCliOutput(`Checkmarx CLI exited with ${code ?? signal}: ${(stderr || stdout).slice(-8192).trim()}`, env)));
        return;
      }
      resolve(stdout);
    });
  });
}

export function parseCliJson(output: string): unknown {
  const text = output.trim();
  try { return JSON.parse(text); } catch {}
  for (let start = 0; start < text.length; start++) {
    if ((text[start] !== '{' && text[start] !== '[') || (start > 0 && text[start - 1] !== '\n')) continue;
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (let end = start; end < text.length; end++) {
      const char = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') stack.push(char);
      else if (char === '}' || char === ']') {
        stack.pop();
        if (!stack.length) {
          try { return JSON.parse(text.slice(start, end + 1)); } catch { break; }
        }
      }
    }
  }
  throw new Error('The CLI did not return valid JSON. Check its version and the CLI output.');
}
