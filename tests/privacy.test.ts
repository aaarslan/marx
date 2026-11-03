import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/verify-privacy.ts', import.meta.url));
const classic = ['ghp', 'a'.repeat(36)].join('_');
const fineGrained = ['github', 'pat', 'a'.repeat(22), 'b'.repeat(59)].join('_');
const stateless = ['ghs', '123456', ['a'.repeat(20), 'b'.repeat(20), 'c'.repeat(20)].join('.')].join('_');
let directory: string;

function stage(content: string | Buffer) {
  writeFileSync(join(directory, 'fixture.txt'), content);
  execFileSync('git', ['add', '--', 'fixture.txt'], { cwd: directory, stdio: 'ignore' });
}

function verify(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: 'utf8', timeout: 10000 });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

function expectCredentialRejected(result: ReturnType<typeof verify>, credential: string) {
  expect(result.status).toBe(1);
  expect(result.output).toContain('GitHub credential signature found in fixture.txt');
  expect(result.output).not.toContain(credential);
  expect(result.output).not.toContain(script);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'marx-privacy-test-'));
  execFileSync('git', ['init', '--quiet'], { cwd: directory, stdio: 'ignore' });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('privacy verification checks the content being published', () => {
  it('accepts clean staged and tracked files', () => {
    stage('Synthetic fixture without credentials.\n');
    expect(verify().status).toBe(0);
    expect(verify('--all').status).toBe(0);
  });

  it('keeps the default check limited to the staged version', () => {
    stage('Clean staged content.\n');
    writeFileSync(join(directory, 'fixture.txt'), classic);
    expect(verify().status).toBe(0);
  });

  it('rejects a staged credential even when the working file is clean', () => {
    stage(classic);
    writeFileSync(join(directory, 'fixture.txt'), 'Clean working content.\n');
    expectCredentialRejected(verify('--all'), classic);
  });

  it('rejects a staged credential even when the working file was removed', () => {
    stage(classic);
    rmSync(join(directory, 'fixture.txt'));
    expectCredentialRejected(verify('--all'), classic);
  });

  it('also checks unstaged content in tracked files with --all', () => {
    stage('Clean staged content.\n');
    writeFileSync(join(directory, 'fixture.txt'), fineGrained);
    expectCredentialRejected(verify('--all'), fineGrained);
  });

  it.each([
    ['classic personal access token', classic],
    ['fine-grained personal access token', fineGrained],
    ['stateless installation token', stateless],
    ['OAuth access token', ['gho', 'a'.repeat(36)].join('_')],
    ['app user token', ['ghu', 'a'.repeat(36)].join('_')],
    ['installation token', ['ghs', 'a'.repeat(36)].join('_')],
    ['refresh token', ['ghr', 'a'.repeat(36)].join('_')],
  ])('rejects a synthetic %s without printing it', (_name, credential) => {
    stage(credential);
    expectCredentialRejected(verify(), credential);
  });

  it('detects fine-grained credentials in UTF-16 content', () => {
    stage(Buffer.from(fineGrained, 'utf16le'));
    expectCredentialRejected(verify(), fineGrained);
  });

  it.each(['utf8', 'utf16le'] as const)('rejects home paths and delimited home values in %s content', (encoding) => {
    const home = homedir();
    const path = join(home, 'synthetic-project', 'source.ts');
    for (const value of [path, path.replaceAll('\\', '/'), path.replaceAll('\\', '\\\\'), home, `"${home}"`, `${home}\n`, `${home}\0`]) {
      stage(Buffer.concat([Buffer.from([255]), Buffer.from(value, encoding)]));
      const result = verify();
      expect(result.status).toBe(1);
      expect(result.output).toContain('Personal home-directory path found in fixture.txt');
      expect(result.output).not.toContain(value);
      expect(result.output).not.toContain(script);
    }
  });

  it.each(['utf8', 'utf16le'] as const)('does not mistake longer path components for the home directory in %s content', (encoding) => {
    const home = homedir();
    for (const value of [`${home}ed/source.ts`, `${home}.go`, `${home}_windows.go`, `os${home.replaceAll('\\', '/')}_openat.go`]) {
      stage(Buffer.from(value, encoding));
      expect(verify().status).toBe(0);
    }
  });
});
