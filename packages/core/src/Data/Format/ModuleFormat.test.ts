import { describe, it, expect } from 'vitest';
import { MODULE_TYPES, ModuleType } from '../Core/Types';
import {
  FORMAT_VERSION,
  READABLE_FORMAT_VERSIONS,
  LEGACY_FORMAT_VERSIONS,
  CONTENT_MAP,
  parseFormatVersion,
  isReadableFormatVersion,
} from './ModuleFormat';

// Compile-time exhaustiveness check: CONTENT_MAP is declared as
// `Record<ModuleType, ...>`, so this assignment fails to typecheck the
// moment MODULE_TYPES grows a member that ModuleFormat.ts has not been
// updated to cover. No hand-written list of keys to fall out of sync.
const _exhaustive: Record<ModuleType, unknown> = CONTENT_MAP;
void _exhaustive;

describe('parseFormatVersion / isReadableFormatVersion', () => {
  it('reports the current version as current and readable', () => {
    expect(parseFormatVersion(FORMAT_VERSION)).toEqual({ version: FORMAT_VERSION, kind: 'current' });
    expect(isReadableFormatVersion(FORMAT_VERSION)).toBe(true);
  });

  it('reads 0.1 and 0.2', () => {
    for (const v of ['0.1', '0.2']) {
      expect(isReadableFormatVersion(v)).toBe(true);
    }
    // 0.1 is older than the current 0.2, so it is 'readable', not 'current'.
    expect(parseFormatVersion('0.1')).toEqual({ version: '0.1', kind: 'readable' });
    // 0.2 IS the current version.
    expect(parseFormatVersion('0.2')).toEqual({ version: '0.2', kind: 'current' });
  });

  it('reads every version actually listed in READABLE_FORMAT_VERSIONS / LEGACY_FORMAT_VERSIONS', () => {
    for (const v of READABLE_FORMAT_VERSIONS) expect(isReadableFormatVersion(v)).toBe(true);
    for (const v of LEGACY_FORMAT_VERSIONS) expect(isReadableFormatVersion(v)).toBe(true);
  });

  it('reads 2.0 as legacy - readable, but distinct from current/readable', () => {
    const result = parseFormatVersion('2.0');
    expect(result.kind).toBe('legacy');
    expect(result.kind).not.toBe('current');
    expect(isReadableFormatVersion('2.0')).toBe(true);
  });

  it('refuses an unknown newer 0.x rather than treating it as a range', () => {
    // 0.3 is numerically "newer" than 0.2 but is NOT in the allow-list, so it
    // must be refused. This is the case that would pass under a mistaken
    // `version <= FORMAT_VERSION` implementation.
    expect(parseFormatVersion('0.3')).toEqual({ version: '0.3', kind: 'unsupported' });
    expect(isReadableFormatVersion('0.3')).toBe(false);
  });

  it('refuses any major >= 1 that is not a listed legacy string', () => {
    expect(parseFormatVersion('1.0')).toEqual({ version: '1.0', kind: 'unsupported' });
    expect(isReadableFormatVersion('1.0')).toBe(false);
    expect(parseFormatVersion('2.5')).toEqual({ version: '2.5', kind: 'unsupported' });
    expect(isReadableFormatVersion('2.5')).toBe(false);
  });

  it('never throws on malformed strings, and reports them unsupported', () => {
    for (const v of ['', 'x', 'abc']) {
      expect(() => parseFormatVersion(v)).not.toThrow();
      expect(parseFormatVersion(v)).toEqual({ version: v, kind: 'unsupported' });
      expect(isReadableFormatVersion(v)).toBe(false);
    }
  });
});

describe('CONTENT_MAP', () => {
  it('has an entry for every ModuleType', () => {
    for (const type of MODULE_TYPES) {
      expect(Object.prototype.hasOwnProperty.call(CONTENT_MAP, type)).toBe(true);
      expect(CONTENT_MAP[type]).toBeDefined();
    }
  });

  it('has no extra keys beyond ModuleType', () => {
    const known = new Set<string>(MODULE_TYPES);
    for (const key of Object.keys(CONTENT_MAP)) {
      expect(known.has(key)).toBe(true);
    }
  });

  it('cross_reference and tag_graph carry no ContentShape entries', () => {
    expect(CONTENT_MAP.cross_reference).toEqual([]);
    expect(CONTENT_MAP.tag_graph).toEqual([]);
  });

  it('lexicon mirrors dictionary (legacy alias, same table)', () => {
    expect(CONTENT_MAP.lexicon).toEqual(CONTENT_MAP.dictionary);
  });
});
