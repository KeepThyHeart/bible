/**
 * The `.bibleignore` matcher used by `bible-ext package`.
 *
 * Deliberately a small subset of gitignore rather than a reimplementation of
 * it: `#` comments, blank lines, a trailing `/` for "this directory and
 * everything under it", `*` within a path segment and `**` across segments.
 * There is no negation (`!`) and no anchoring subtleties, because a packaging
 * ignore file that behaves *almost* like gitignore is worse than one that
 * obviously does not - the failure mode of the first is an author shipping a
 * file they believed was excluded.
 *
 * Patterns match the entry's path relative to the extension root, POSIX-style.
 */

/** Excluded whether or not a `.bibleignore` exists. */
export const DEFAULT_IGNORES: readonly string[] = [
  'node_modules/',
  '.git/',
  '.gitignore',
  '.bibleignore',
  '.DS_Store',
  '**/*.zip',
  '**/*.tgz',
  // Source maps name paths on the author's machine and are useless to the
  // host, which cannot open a debugger against a QuickJS realm anyway.
  '**/*.map',
];

export interface IgnoreMatcher {
  (relativePath: string, isDirectory: boolean): boolean;
}

function patternToRegExp(pattern: string): RegExp {
  const directoryOnly = pattern.endsWith('/');
  const body = directoryOnly ? pattern.slice(0, -1) : pattern;

  let source = '';
  let i = 0;
  while (i < body.length) {
    const char = body[i]!;
    if (char === '*') {
      if (body[i + 1] === '*') {
        // `**/` consumes any number of leading segments, including none.
        if (body[i + 2] === '/') {
          source += '(?:[^/]+/)*';
          i += 3;
          continue;
        }
        source += '.*';
        i += 2;
        continue;
      }
      source += '[^/]*';
      i += 1;
      continue;
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }

  // A directory pattern also excludes everything beneath it.
  return new RegExp(`^${source}${directoryOnly ? '(?:/.*)?' : ''}$`);
}

export function parseIgnoreFile(contents: string): string[] {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export function createIgnoreMatcher(patterns: readonly string[]): IgnoreMatcher {
  const compiled = patterns.map((p) => ({
    directoryOnly: p.endsWith('/'),
    regex: patternToRegExp(p),
  }));

  return (relativePath: string, isDirectory: boolean): boolean => {
    for (const { directoryOnly, regex } of compiled) {
      if (!regex.test(relativePath)) continue;
      // `foo/` means a *directory* named foo. It matches the directory itself
      // and everything beneath it, but never a plain file that happens to be
      // called `foo` — matching that would silently drop a file the author
      // never asked to exclude.
      if (directoryOnly && !isDirectory && !relativePath.includes('/')) continue;
      return true;
    }
    return false;
  };
}
