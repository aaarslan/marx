import { describe, expect, it, vi } from 'vitest';
import { CLI_CAPABILITY_COMMANDS, flagsFromHelp, inspectCliCapabilities, requireScanCapabilities } from '../src/main/cliCapabilities';

const help = (args: string[]) => {
  if (args[0] === 'version') return '2.3.69-fixture';
  const name = args.slice(0, -1).join(' ');
  const command = CLI_CAPABILITY_COMMANDS.find((entry) => entry.args.join(' ') === name);
  return `Usage:\n  cx ${name}\nFlags:\n${command?.flags.map((flag) => `  --${flag} string   Description`).join('\n')}`;
};

describe('CLI capability preflight', () => {
  it('probes only local version and help and bounds every process', async () => {
    const run = vi.fn(async ({ args }) => help(args));
    const result = await inspectCliCapabilities('/approved/cx', {}, run);
    expect(result.version).toBe('2.3.69-fixture');
    expect(run.mock.calls.every(([call]) => call.args[0] === 'version' || call.args.at(-1) === '--help')).toBe(true);
    for (const [call] of run.mock.calls) expect(call).toMatchObject({ timeoutMs: 10_000, maxOutputBytes: 524288 });
  });

  it('rejects an obsolete CLI before any authenticated or upload command', async () => {
    const run = vi.fn(async ({ args }) => help(args).replace('  --scan-info-format string   Description', 'Example: --scan-info-format=json'));
    await expect(inspectCliCapabilities('/approved/cx', {}, run)).rejects.toThrow('--scan-info-format');
    expect(run.mock.calls.every(([call]) => call.args[0] === 'version' || call.args.includes('--help'))).toBe(true);
  });

  it('checks optional flags against the actual scan arguments', async () => {
    const result = await inspectCliCapabilities('/approved/cx', {}, async ({ args }) => help(args));
    expect(() => requireScanCapabilities(result, ['scan', 'create', '--base-branch=main'])).toThrow('--base-branch');
    expect(() => requireScanCapabilities(result, ['scan', 'create', '--retry=0'])).not.toThrow();
  });

  it('does not accept flags mentioned only in prose', () => {
    expect([...flagsFromHelp('Example: --unsafe\n  -f, --format string\n      --retry int\n  --name=value')]).toEqual(['format', 'retry', 'name']);
  });

  it('stops immediately when canceled and hides raw probe failures', async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(async ({ signal }) => { signal?.throwIfAborted(); return ''; });
    await expect(inspectCliCapabilities('/approved/cx', {}, run, controller.signal)).rejects.toThrow();
    await expect(inspectCliCapabilities('/approved/cx', {}, async () => { throw new Error('private config data'); })).rejects.toThrow('No upload was started');
  });
});
