import type { CliProcessOptions } from './cliProcess';

export interface CliCapabilities {
  version: string;
  commands: Record<string, Set<string>>;
}

export const CLI_CAPABILITY_COMMANDS = [
  { args: [], flags: ['debug', 'retry', 'config-file-path'] },
  { args: ['auth', 'validate'], flags: [] },
  { args: ['project', 'list'], flags: ['format', 'filter'] },
  { args: ['project', 'show'], flags: ['project-id', 'format'] },
  { args: ['scan', 'create'], flags: ['file-source', 'project-name', 'branch', 'scan-types', 'async', 'scan-info-format', 'skip-default-filter', 'file-filter', 'exclude-git-folder', 'sast-incremental', 'sast-preset-name', 'sca-exploitable-path'] },
  { args: ['scan', 'show'], flags: ['scan-id', 'format'] },
  { args: ['scan', 'list'], flags: ['format', 'filter'] },
  { args: ['scan', 'cancel'], flags: ['scan-id'] },
  { args: ['results', 'show'], flags: ['scan-id', 'report-format', 'output-name', 'output-path'] }
] as const;

export function flagsFromHelp(help: string): Set<string> {
  const flags = new Set<string>();
  for (const line of help.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:-[\w?],\s*)?--([a-z][a-z0-9-]*)(?=\s|=|$)/);
    if (match) flags.add(match[1]);
  }
  return flags;
}

export async function inspectCliCapabilities(executable: string, env: NodeJS.ProcessEnv, run: (options: CliProcessOptions) => Promise<string>, signal?: AbortSignal): Promise<CliCapabilities> {
  const timeout = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const invoke = (args: string[]) => run({ executable, args, env, signal: combined, timeoutMs: 10_000, maxOutputBytes: 512 * 1024 });
  let version = 'unknown';
  try { version = (await invoke(['version'])).trim().slice(0, 120) || 'unknown'; } catch {
    combined.throwIfAborted();
    throw new Error('Could not identify the selected Checkmarx CLI. Select your organization’s approved cx executable in Settings. No upload was started.');
  }
  const commands: Record<string, Set<string>> = {};
  for (const command of CLI_CAPABILITY_COMMANDS) {
    combined.throwIfAborted();
    const name = command.args.join(' ') || 'cx';
    let help: string;
    try { help = await invoke([...command.args, '--help']); } catch {
      combined.throwIfAborted();
      throw new Error(`The selected Checkmarx CLI (${version}) cannot describe "${name}". Choose a compatible approved CLI in Settings. No upload was started.`);
    }
    const flags = flagsFromHelp(help);
    const missing = command.flags.filter((flag) => !flags.has(flag));
    if (missing.length) throw new Error(`The selected Checkmarx CLI (${version}) is missing ${name}: ${missing.map((flag) => `--${flag}`).join(', ')}. Update to a compatible organization-approved CLI or select another executable in Settings. No upload was started.`);
    commands[name] = flags;
  }
  return { version, commands };
}

export function requireScanCapabilities(capabilities: CliCapabilities, args: string[]): void {
  const root = capabilities.commands.cx;
  const create = capabilities.commands['scan create'];
  const missing = args.filter((arg) => arg.startsWith('--')).map((arg) => arg.slice(2).split('=')[0]).filter((flag) => !root?.has(flag) && !create?.has(flag));
  if (missing.length) throw new Error(`The selected Checkmarx CLI (${capabilities.version}) does not support ${[...new Set(missing)].map((flag) => `--${flag}`).join(', ')}. Choose a compatible approved CLI in Settings. No upload was started.`);
}
