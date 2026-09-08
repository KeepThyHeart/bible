/**
 * Tiny semver range matcher.
 *
 * The host needs to enforce `manifest.engines.bibleApp` against
 * `EXTENSION_API_VERSION` at activate time. Pulling in `node-semver` for one
 * comparison would inflate the bundle and add a runtime dep, so this file
 * implements just the subset of the npm semver range grammar the host's API
 * versioning rules need:
 *
 *   - exact: `1.2.3`
 *   - caret: `^1.2.3`   (>=1.2.3 <2.0.0; for 0.x: >=0.1.2 <0.2.0)
 *   - tilde: `~1.2.3`   (>=1.2.3 <1.3.0)
 *   - x-range: `1.x`, `1.2.x`, `*`
 *   - comparator list: `>=1.0.0 <2.0.0` (whitespace-separated AND)
 *   - OR: `^1.0.0 || ^2.0.0`
 *
 * Anything more exotic is not supported and `satisfies` returns false rather
 * than throwing - the caller surfaces that as `IncompatibleApiVersionError`.
 */

export interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(input: string): SemverParts | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

function compare(a: SemverParts, b: SemverParts): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

type Bound = { op: '>=' | '>' | '<=' | '<' | '='; v: SemverParts };

function expandComparator(token: string): Bound[] | null {
  const t = token.trim();
  if (!t) return [];
  if (t === '*') return []; // matches anything

  // Caret: ^1.2.3
  if (t.startsWith('^')) {
    const v = parseVersion(t.slice(1));
    if (!v) return null;
    let upper: SemverParts;
    if (v.major > 0) {
      upper = { major: v.major + 1, minor: 0, patch: 0 };
    } else if (v.minor > 0) {
      upper = { major: 0, minor: v.minor + 1, patch: 0 };
    } else {
      upper = { major: 0, minor: 0, patch: v.patch + 1 };
    }
    return [
      { op: '>=', v },
      { op: '<', v: upper },
    ];
  }

  // Tilde: ~1.2.3
  if (t.startsWith('~')) {
    const v = parseVersion(t.slice(1));
    if (!v) return null;
    return [
      { op: '>=', v },
      { op: '<', v: { major: v.major, minor: v.minor + 1, patch: 0 } },
    ];
  }

  // x-range: 1.x or 1.2.x
  const xRange = /^(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/.exec(t);
  if (xRange && (xRange[2] === undefined || /^[xX*]$/.test(xRange[2]) || xRange[3] === undefined || /^[xX*]$/.test(xRange[3] ?? ''))) {
    const major = Number(xRange[1]);
    const minorRaw = xRange[2];
    const patchRaw = xRange[3];
    if (minorRaw === undefined || /^[xX*]$/.test(minorRaw)) {
      return [
        { op: '>=', v: { major, minor: 0, patch: 0 } },
        { op: '<', v: { major: major + 1, minor: 0, patch: 0 } },
      ];
    }
    const minor = Number(minorRaw);
    if (patchRaw === undefined || /^[xX*]$/.test(patchRaw)) {
      return [
        { op: '>=', v: { major, minor, patch: 0 } },
        { op: '<', v: { major, minor: minor + 1, patch: 0 } },
      ];
    }
    // fall through to exact below
  }

  // Comparator with op: >=1.2.3, >1.2.3, <=1.2.3, <1.2.3, =1.2.3
  const opMatch = /^(>=|<=|>|<|=)\s*(.+)$/.exec(t);
  if (opMatch) {
    const v = parseVersion(opMatch[2]!);
    if (!v) return null;
    return [{ op: opMatch[1] as Bound['op'], v }];
  }

  // Bare version -> exact
  const bare = parseVersion(t);
  if (!bare) return null;
  return [{ op: '=', v: bare }];
}

function satisfiesAnd(version: SemverParts, comparators: Bound[]): boolean {
  for (const b of comparators) {
    const c = compare(version, b.v);
    switch (b.op) {
      case '=':
        if (c !== 0) return false;
        break;
      case '>':
        if (c <= 0) return false;
        break;
      case '>=':
        if (c < 0) return false;
        break;
      case '<':
        if (c >= 0) return false;
        break;
      case '<=':
        if (c > 0) return false;
        break;
    }
  }
  return true;
}

/**
 * Returns true iff `version` satisfies `range`. Returns false on any parse
 * failure (the caller surfaces this as IncompatibleApiVersionError).
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  // Split on '||' for OR groups, then split each group on whitespace for AND.
  const orGroups = range.split('||');
  for (const group of orGroups) {
    const tokens = group.trim().split(/\s+/).filter(Boolean);
    const expanded: Bound[] = [];
    let parseFailed = false;
    for (const tok of tokens) {
      const bounds = expandComparator(tok);
      if (bounds === null) {
        parseFailed = true;
        break;
      }
      expanded.push(...bounds);
    }
    if (parseFailed) continue;
    if (satisfiesAnd(v, expanded)) return true;
  }
  return false;
}
