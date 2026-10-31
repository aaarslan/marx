import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type Filter = (file: string, stat: { isDirectory(): boolean }) => boolean;
interface Matcher {
  excludePatterns: unknown[] | null;
  createFilter(): Filter;
  computeParsedPatterns(result: unknown[], fromDir?: string): void;
}
const { FileMatcher, getMainFileMatchers, getFileMatchers } = require('app-builder-lib/out/fileMatcher') as {
  FileMatcher: new (from: string, to: string, expand: (value: string) => string, patterns: string[]) => Matcher;
  getMainFileMatchers(...args: unknown[]): Matcher[];
  getFileMatchers(...args: unknown[]): Matcher[];
};
const { createFilter } = require('app-builder-lib/out/util/filter') as { createFilter(root: string, patterns: unknown[], excludePatterns: unknown[] | null): Filter };
const filter = (patterns: string[]) => new FileMatcher('/app', '/dest', (value) => value, patterns).createFilter();

describe('packaging pattern bounds', () => {
  it('rejects combinatorial brace expansion before evaluating inclusion or exclusion rules', () => {
    const pattern = '{a,b}'.repeat(20);
    expect(() => filter([pattern])).toThrow(/brace alternatives/);
    expect(() => filter(['**/*', `!${pattern}`])).toThrow(/brace alternatives/);
    expect(() => filter(['a'.repeat(4097)])).toThrow(/4096/);
  });

  it('traverses every brace path alternative and rejects unrelated directories', () => {
    const accepts = filter(['assets/{images/icons,fonts/web}/file.bin']);
    for (const directory of ['assets', 'assets/images', 'assets/images/icons', 'assets/fonts', 'assets/fonts/web']) {
      expect(accepts(`/app/${directory}`, { isDirectory: () => true })).toBe(true);
    }
    for (const directory of ['docs', 'assets/images/private', 'assets/fonts/desktop']) {
      expect(accepts(`/app/${directory}`, { isDirectory: () => true })).toBe(false);
    }
    expect(accepts('/app/assets/images/icons/file.bin', { isDirectory: () => false })).toBe(true);
    expect(accepts('/app/assets/fonts/web/file.bin', { isDirectory: () => false })).toBe(true);
    expect(accepts('/app/assets/fonts/web/other.bin', { isDirectory: () => false })).toBe(false);
  });

  it('bounds compiled directory prefixes when short patterns amplify into long alternatives', () => {
    const branched = `{a,b,c,d,e,f,g,h}${'/x'.repeat(400)}/file.bin`;
    const longPrefixes = `${'a'.repeat(2000)}${'/x'.repeat(600)}/file.bin`;
    expect(branched.length).toBeLessThan(4096);
    expect(longPrefixes.length).toBeLessThan(4096);
    expect(() => filter([branched])).toThrow(/traversal prefixes/);
    expect(() => filter([longPrefixes])).toThrow(/compiled prefix characters/);
  });

  it('supports segment extglobs and fails explicitly for extglobs spanning path segments', () => {
    const accepts = filter(['assets/@(images|fonts)/**/file.bin']);
    expect(accepts('/app/assets/images/nested', { isDirectory: () => true })).toBe(true);
    expect(accepts('/app/assets/private', { isDirectory: () => true })).toBe(false);
    expect(() => filter(['assets/@(images/icons|fonts/web)/file.bin'])).toThrow(/path separators inside extglobs/);
  });

  it('treats mapped source directories and individual files as literal paths', () => {
    const root = path.resolve('packaging-fixture');
    const source = path.join(root, 'extra (assets) [v1]');
    const mapped = new FileMatcher(source, path.join(root, 'dest'), (value) => value, ['**/*', '!**/*.map']);
    const patterns: unknown[] = [];
    mapped.computeParsedPatterns(patterns, root);
    const accepts = createFilter(root, patterns, null);
    expect(accepts(source, { isDirectory: () => true })).toBe(true);
    expect(accepts(path.join(source, 'nested'), { isDirectory: () => true })).toBe(true);
    expect(accepts(path.join(source, 'nested', 'file.txt'), { isDirectory: () => false })).toBe(true);
    expect(accepts(path.join(source, 'nested', 'file.map'), { isDirectory: () => false })).toBe(false);
    expect(accepts(path.join(root, 'extra assets v', 'file.txt'), { isDirectory: () => false })).toBe(false);
    const main = new FileMatcher(root, path.join(root, 'dest'), (value) => value, ['**/*']);
    main.excludePatterns = patterns;
    expect(main.createFilter()(path.join(source, 'nested', 'file.txt'), { isDirectory: () => false })).toBe(false);
    const literal = new FileMatcher(path.join(source, 'config (one) [x].json'), path.join(root, 'dest'), (value) => value, []);
    const files: unknown[] = [];
    literal.computeParsedPatterns(files, root);
    const fileFilter = createFilter(root, files, null);
    expect(fileFilter(source, { isDirectory: () => true })).toBe(true);
    expect(fileFilter(path.join(source, 'config (one) [x].json'), { isDirectory: () => false })).toBe(true);
    expect(fileFilter(path.join(source, 'config one x.json'), { isDirectory: () => false })).toBe(false);
  });

  it('quotes literal build and output directories in generated exclusion patterns', () => {
    const root = path.resolve('packaging-fixture');
    const output = path.join(root, 'release (nightly) [x]');
    const config = { files: ['**/*'] };
    const info = { projectDir: root, buildResourcesDir: 'build (icons) [dark]', config, isPrepackedAppAsar: false, debugLogger: { isEnabled: false } };
    const [main] = getMainFileMatchers(root, path.join(root, 'dest'), (value: string) => value, {}, { info }, output, false);
    const accepts = main.createFilter();
    expect(accepts(path.join(root, 'build (icons) [dark]', 'icon.png'), { isDirectory: () => false })).toBe(false);
    expect(accepts(path.join(output, 'bundle.zip'), { isDirectory: () => false })).toBe(false);
    expect(accepts(path.join(root, 'build icons d', 'icon.png'), { isDirectory: () => false })).toBe(true);
    expect(accepts(path.join(root, 'build [(]icons[)] [dark]', 'icon.png'), { isDirectory: () => false })).toBe(true);
    const [files] = getFileMatchers({ files: ['**/*'] }, 'files', path.join(root, 'dest'), { defaultSrc: root, globalOutDir: output, customBuildOptions: {}, macroExpander: (value: string) => value });
    const fileFilter = files.createFilter();
    expect(fileFilter(path.join(output, 'linux-unpacked', 'main.js'), { isDirectory: () => false })).toBe(false);
    expect(fileFilter(path.join(output, 'bundle.zip'), { isDirectory: () => false })).toBe(true);
  });
});
