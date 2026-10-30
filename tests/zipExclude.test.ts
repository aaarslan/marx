import { describe, expect, it } from 'vitest';
import { isExcluded } from '../src/main/zipSource';

describe('isExcluded', () => {
  const excludes = ['.git', 'node_modules', 'dist'];

  it('excludes top-level folders', () => {
    expect(isExcluded('node_modules/react/index.js', excludes)).toBe(true);
    expect(isExcluded('.git/config', excludes)).toBe(true);
    expect(isExcluded('dist/bundle.js', excludes)).toBe(true);
  });

  it('excludes nested folders with the same name', () => {
    expect(isExcluded('packages/lib/node_modules/dep/x.js', excludes)).toBe(true);
    expect(isExcluded('apps/web/dist/main.js', excludes)).toBe(true);
  });

  it('keeps normal source files', () => {
    expect(isExcluded('src/app.jsx', excludes)).toBe(false);
    expect(isExcluded('package.json', excludes)).toBe(false);
    expect(isExcluded('apps/node/package.json', excludes)).toBe(false);
  });

  it('handles whitespace and empty patterns', () => {
    expect(isExcluded('src/a.js', ['  ', '', '  dist  '])).toBe(false);
    expect(isExcluded('dist/a.js', ['  dist  '])).toBe(true);
  });
});
