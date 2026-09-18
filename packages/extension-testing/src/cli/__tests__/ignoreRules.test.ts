import { describe, it, expect } from 'vitest';
import { createIgnoreMatcher, parseIgnoreFile, DEFAULT_IGNORES } from '../ignoreRules';

describe('parseIgnoreFile', () => {
  it('drops blank lines and comments, and trims whitespace', () => {
    expect(parseIgnoreFile('# a comment\n\n  test/  \nnotes.txt\n\n')).toEqual([
      'test/',
      'notes.txt',
    ]);
  });

  it('handles CRLF, which is what an editor on Windows writes', () => {
    expect(parseIgnoreFile('test/\r\nnotes.txt\r\n')).toEqual(['test/', 'notes.txt']);
  });
});

describe('createIgnoreMatcher', () => {
  it('matches an exact file path', () => {
    const ignored = createIgnoreMatcher(['notes.txt']);
    expect(ignored('notes.txt', false)).toBe(true);
    expect(ignored('other.txt', false)).toBe(false);
  });

  it('matches a directory and everything beneath it', () => {
    const ignored = createIgnoreMatcher(['test/']);
    expect(ignored('test', true)).toBe(true);
    expect(ignored('test/main.test.ts', false)).toBe(true);
    expect(ignored('test/deep/nested.ts', false)).toBe(true);
  });

  it('does not let a directory pattern swallow a file of the same name', () => {
    const ignored = createIgnoreMatcher(['test/']);
    // `test/` means a directory. A plain file named `test` is a different
    // thing, and excluding it would drop something never asked for.
    expect(ignored('test', false)).toBe(false);
  });

  it('confines a single star to one path segment', () => {
    const ignored = createIgnoreMatcher(['*.log']);
    expect(ignored('debug.log', false)).toBe(true);
    expect(ignored('logs/debug.log', false)).toBe(false);
  });

  it('lets ** cross path segments', () => {
    const ignored = createIgnoreMatcher(['**/*.map']);
    expect(ignored('main.js.map', false)).toBe(true);
    expect(ignored('dist/main.js.map', false)).toBe(true);
    expect(ignored('dist/deep/main.js.map', false)).toBe(true);
    expect(ignored('dist/main.js', false)).toBe(false);
  });

  it('treats dots as literals rather than regex wildcards', () => {
    const ignored = createIgnoreMatcher(['a.txt']);
    expect(ignored('axtxt', false)).toBe(false);
  });

  it('ignores nothing when given no patterns', () => {
    const ignored = createIgnoreMatcher([]);
    expect(ignored('anything', false)).toBe(false);
  });

  describe('the built-in defaults', () => {
    const ignored = createIgnoreMatcher(DEFAULT_IGNORES);

    it('excludes dependency and VCS directories', () => {
      expect(ignored('node_modules', true)).toBe(true);
      expect(ignored('node_modules/left-pad/index.js', false)).toBe(true);
      expect(ignored('.git', true)).toBe(true);
    });

    it('excludes archives and source maps at any depth', () => {
      expect(ignored('build/thing.zip', false)).toBe(true);
      expect(ignored('thing.tgz', false)).toBe(true);
      expect(ignored('dist/main.js.map', false)).toBe(true);
    });

    it('keeps the things an extension is actually made of', () => {
      expect(ignored('extension.json', false)).toBe(false);
      expect(ignored('dist/main.js', false)).toBe(false);
      expect(ignored('ui/index.html', false)).toBe(false);
    });
  });
});
