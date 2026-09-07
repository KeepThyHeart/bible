/**
 * Version comparison for installed-vs-incoming modules.
 *
 * This exists for exactly one decision: when a module that is already
 * installed turns up again - in a study pack, a re-imported file, a catalog
 * update - should it replace what is on disk?
 *
 * ## Why not a semver library
 *
 * Module versions are publisher-authored strings in `module_info`
 * (`content_version`). Nothing
 * validates them at conversion time and nothing can: modules are converted
 * from SWORD and other upstreams whose versioning conventions we do not
 * control. Real values seen in the wild include `2.3.1`, `1.0`, `v3`,
 * `20240115` (a date), and `1769` (an edition year). A strict semver parser
 * would reject most of those, and a lenient one would silently invent an
 * ordering for strings that have none.
 *
 * So this returns `incomparable` as a first-class answer rather than guessing.
 * `incomparable` is what makes the "replace if newer" policy safe: two
 * versions we cannot order are never treated as an upgrade, so an ambiguous
 * string can never cause a silent overwrite of content the user already has.
 * The caller decides what to do with that (see `ModuleInstallPolicy` in
 * `moduleHandlers.ts`, which skips).
 *
 * ## What IS comparable
 *
 * Dotted numeric releases with an optional semver-style prerelease tag:
 * `1`, `1.0`, `1.0.0`, `v2.3.1`, `1.0.0-beta.2`. Missing trailing components
 * are zero, so `1.0` and `1.0.0` are the SAME version, not adjacent ones -
 * a publisher who writes `1.0` in one build and `1.0.0` in the next has not
 * shipped an update, and treating that as one would reinstall on every scan.
 *
 * Everything else - pure dates, edition years, names, empty strings - is
 * `incomparable` unless the two strings are byte-identical after
 * normalization, which is reported as `same`.
 */

/**
 * Result of ordering an incoming version against an installed one.
 *
 * `newer` / `older` / `same` are relative to the FIRST argument, i.e. `newer`
 * means "the candidate supersedes what is installed".
 */
export type VersionComparison = 'newer' | 'older' | 'same' | 'incomparable';

/** Longest version string we will even look at. Beyond this is not a version. */
const MAX_VERSION_LENGTH = 64;

/**
 * A version written as a SINGLE number is only believed when it is below this.
 *
 * This is the rule that keeps dates and edition years out of the ordering, and
 * it is load-bearing. `20240115` and `1769` are both perfectly good matches for
 * "a run of digits", so without a bound they parse as version 20240115 and
 * version 1769 and compare as enormous release numbers - which would make a
 * date-stamped module read as an upgrade over every dotted version it met, and
 * make the 1769 KJV an "upgrade" over the 1611. That is precisely the silent
 * overwrite this module exists to prevent.
 *
 * The cutoff is a heuristic, and deliberately a blunt one: a bare single-part
 * version number in real module metadata is small (`1`, `2`, `12`), while
 * anything four digits or longer is overwhelmingly a year or a date. Values at
 * or above the cutoff are reported `incomparable` rather than guessed at, so
 * the cost of the heuristic being wrong is a skipped update the user can force
 * - never an unwanted overwrite.
 *
 * Multi-component versions (`1.0`, `2.3.1`) are exempt: `2024.1` is
 * unambiguously versioned, whatever the first component means.
 */
const MAX_BARE_VERSION_COMPONENT = 1000;

/**
 * Dotted numeric core with an optional prerelease tail.
 *
 * The core is 1-4 numeric components (`1`, `1.0`, `1.0.0`, `1.0.0.0` - the
 * four-part form shows up in modules converted from Windows-native tools).
 * The prerelease tail is the semver shape: `-` followed by dot-separated
 * alphanumeric identifiers.
 */
const NUMERIC_VERSION_RE = /^(\d{1,9}(?:\.\d{1,9}){0,3})(?:-([0-9A-Za-z.-]+))?$/;

/**
 * Strip decoration a publisher may have added around the version proper.
 * Returns an empty string for anything that cannot be a version at all.
 */
function normalize(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_VERSION_LENGTH) return '';
  // A leading `v`/`V` is decoration, not part of the number: `v1.2` and `1.2`
  // are the same release and must not compare as different.
  return trimmed.replace(/^[vV](?=\d)/, '');
}

interface ParsedVersion {
  /** Numeric components, right-padded with zeros to a fixed width by the comparer. */
  core: number[];
  /**
   * Semver prerelease identifiers, or `undefined` for a final release.
   * A final release always outranks a prerelease of the same core.
   */
  prerelease?: string[];
}

/**
 * Parse a normalized string into comparable parts, or `undefined` when the
 * string is not an orderable version.
 */
function parse(normalized: string): ParsedVersion | undefined {
  const match = NUMERIC_VERSION_RE.exec(normalized);
  if (!match) return undefined;

  const core = match[1]!.split('.').map((part) => Number(part));
  // `Number()` cannot produce NaN here (the regex guarantees digits), but a
  // component wide enough to lose integer precision is not something we want
  // to order silently.
  if (core.some((n) => !Number.isSafeInteger(n))) return undefined;

  // A lone large number is a year or a date, not a release. See
  // MAX_BARE_VERSION_COMPONENT. Note this also catches the `YYYY-MM-DD` shape,
  // which the regex reads as core `YYYY` plus a prerelease tail.
  if (core.length === 1 && core[0]! >= MAX_BARE_VERSION_COMPONENT) return undefined;

  const prereleaseRaw = match[2];
  if (prereleaseRaw === undefined) {
    return { core };
  }
  const prerelease = prereleaseRaw.split('.');
  // `1.0.0-` and `1.0.0-a..b` are malformed rather than orderable.
  if (prerelease.some((id) => id.length === 0)) return undefined;
  return { core, prerelease };
}

/** Compare the numeric cores, treating missing trailing components as zero. */
function compareCores(a: number[], b: number[]): -1 | 0 | 1 {
  const width = Math.max(a.length, b.length);
  for (let i = 0; i < width; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

/**
 * Compare semver prerelease identifier lists.
 *
 * Numeric identifiers order numerically and rank below alphanumeric ones; a
 * longer list outranks its own prefix (`1.0.0-beta.2` > `1.0.0-beta`).
 */
function comparePrerelease(a: string[], b: string[]): -1 | 0 | 1 {
  const width = Math.max(a.length, b.length);
  for (let i = 0; i < width; i++) {
    const av = a[i];
    const bv = b[i];
    // Running out of identifiers means the shorter list ranks lower.
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;

    const aNumeric = /^\d+$/.test(av);
    const bNumeric = /^\d+$/.test(bv);
    if (aNumeric && bNumeric) {
      const an = Number(av);
      const bn = Number(bv);
      if (!Number.isSafeInteger(an) || !Number.isSafeInteger(bn)) {
        return av < bv ? -1 : 1;
      }
      return an > bn ? 1 : -1;
    }
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return av < bv ? -1 : 1;
  }
  return 0;
}

/**
 * Order `candidate` (the incoming module) against `installed` (what is on
 * disk).
 *
 * @returns `newer` when the candidate supersedes the installed module,
 *          `older` when it is behind it, `same` when they are the same
 *          release, and `incomparable` when no ordering can be established -
 *          which callers must NOT treat as an upgrade.
 *
 * @example
 * compareModuleVersions('2.0', '1.9.3')        // 'newer'
 * compareModuleVersions('1.0', '1.0.0')        // 'same'   (trailing zeros)
 * compareModuleVersions('1.0.0-beta', '1.0.0') // 'older'  (prerelease)
 * compareModuleVersions('20240115', '1.2')     // 'incomparable'
 * compareModuleVersions('1769', '1769')        // 'same'   (identical strings)
 */
export function compareModuleVersions(
  candidate: string | null | undefined,
  installed: string | null | undefined
): VersionComparison {
  const a = normalize(candidate);
  const b = normalize(installed);

  // Two identical strings are the same release whether or not we can parse
  // them - this is what lets edition years and dates report `same` and so
  // stops a re-imported pack from reinstalling every module it contains.
  if (a.length > 0 && a === b) return 'same';

  // A missing version on either side leaves nothing to order. Note this comes
  // AFTER the equality check purely for clarity; two empty strings are not
  // "the same version", they are two absences.
  if (a.length === 0 || b.length === 0) return 'incomparable';

  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 'incomparable';

  const coreOrder = compareCores(pa.core, pb.core);
  if (coreOrder !== 0) return coreOrder > 0 ? 'newer' : 'older';

  // Same numeric core: a final release outranks any prerelease of it.
  const aPre = pa.prerelease;
  const bPre = pb.prerelease;
  if (!aPre && !bPre) return 'same';
  if (!aPre) return 'newer';
  if (!bPre) return 'older';

  const preOrder = comparePrerelease(aPre, bPre);
  if (preOrder === 0) return 'same';
  return preOrder > 0 ? 'newer' : 'older';
}

/**
 * Convenience predicate for the `replace-if-newer` install policy.
 *
 * Deliberately strict: only a provable `newer` is an upgrade. `same`,
 * `older`, and `incomparable` all answer `false`, so an unparseable version
 * string can never trigger an overwrite.
 */
export function isUpgrade(
  candidate: string | null | undefined,
  installed: string | null | undefined
): boolean {
  return compareModuleVersions(candidate, installed) === 'newer';
}
