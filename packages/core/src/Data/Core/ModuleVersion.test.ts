import { describe, it, expect } from 'vitest';
import { compareModuleVersions, isUpgrade } from './ModuleVersion';

/**
 * The behaviour that matters here is not "does semver work" - it is the
 * boundary between orderable and unorderable version strings, because that
 * boundary is what decides whether the `replace-if-newer` install policy
 * overwrites a user's content. Everything unorderable must be `incomparable`,
 * and `incomparable` must never read as an upgrade.
 */
describe('compareModuleVersions', () => {
  describe('ordinary dotted releases', () => {
    it.each([
      ['2.0', '1.9.3', 'newer'],
      ['1.0.1', '1.0.0', 'newer'],
      ['1.1.0', '1.0.9', 'newer'],
      ['2.0.0', '10.0.0', 'older'],
      ['1.0.0', '1.0.1', 'older'],
      ['1.2.3', '1.2.3', 'same'],
    ] as const)('%s vs %s -> %s', (a, b, expected) => {
      expect(compareModuleVersions(a, b)).toBe(expected);
    });

    it('compares numerically, not lexically', () => {
      // The whole point: '10' > '9' as a number but '10' < '9' as a string.
      expect(compareModuleVersions('1.10', '1.9')).toBe('newer');
    });

    it('supports the four-part form emitted by Windows-native converters', () => {
      expect(compareModuleVersions('1.0.0.2', '1.0.0.1')).toBe('newer');
    });
  });

  describe('trailing-zero equivalence', () => {
    // A publisher writing `1.0` in one build and `1.0.0` in the next has not
    // shipped an update. Treating that as one would reinstall on every scan.
    it.each([
      ['1.0', '1.0.0'],
      ['1', '1.0.0'],
      ['2.1', '2.1.0.0'],
    ] as const)('%s and %s are the same release', (a, b) => {
      expect(compareModuleVersions(a, b)).toBe('same');
      expect(compareModuleVersions(b, a)).toBe('same');
    });
  });

  describe('decoration', () => {
    it('ignores a leading v', () => {
      expect(compareModuleVersions('v1.2', '1.2')).toBe('same');
      expect(compareModuleVersions('V2.0', '1.0')).toBe('newer');
    });

    it('ignores surrounding whitespace', () => {
      expect(compareModuleVersions('  1.2.0  ', '1.2')).toBe('same');
    });
  });

  describe('prereleases', () => {
    it('ranks a prerelease below its final release', () => {
      expect(compareModuleVersions('1.0.0-beta', '1.0.0')).toBe('older');
      expect(compareModuleVersions('1.0.0', '1.0.0-beta')).toBe('newer');
    });

    it('orders numeric prerelease identifiers numerically', () => {
      expect(compareModuleVersions('1.0.0-beta.10', '1.0.0-beta.9')).toBe('newer');
    });

    it('ranks numeric identifiers below alphanumeric ones', () => {
      expect(compareModuleVersions('1.0.0-1', '1.0.0-alpha')).toBe('older');
    });

    it('ranks a longer identifier list above its own prefix', () => {
      expect(compareModuleVersions('1.0.0-beta.2', '1.0.0-beta')).toBe('newer');
    });

    it('treats identical prereleases as the same', () => {
      expect(compareModuleVersions('1.0.0-rc.1', '1.0.0-rc.1')).toBe('same');
    });

    it('rejects a malformed prerelease rather than inventing an order', () => {
      expect(compareModuleVersions('1.0.0-', '1.0.0')).toBe('incomparable');
      expect(compareModuleVersions('1.0.0-a..b', '1.0.0')).toBe('incomparable');
    });
  });

  describe('strings that carry no ordering', () => {
    it('reports identical unparseable strings as the same', () => {
      // This is what stops a re-imported pack of date- or year-versioned
      // modules from reinstalling every member.
      expect(compareModuleVersions('20240115', '20240115')).toBe('same');
      expect(compareModuleVersions('1769', '1769')).toBe('same');
      expect(compareModuleVersions('KJV 1769', 'KJV 1769')).toBe('same');
    });

    it('refuses to order a date against a dotted version', () => {
      expect(compareModuleVersions('20240115', '1.2')).toBe('incomparable');
    });

    it('refuses to order free text', () => {
      expect(compareModuleVersions('second edition', '1.0')).toBe('incomparable');
      expect(compareModuleVersions('1.0', 'second edition')).toBe('incomparable');
    });

    it('treats a missing version on either side as incomparable', () => {
      expect(compareModuleVersions(undefined, '1.0')).toBe('incomparable');
      expect(compareModuleVersions('1.0', undefined)).toBe('incomparable');
      expect(compareModuleVersions(null, null)).toBe('incomparable');
      expect(compareModuleVersions('', '')).toBe('incomparable');
      expect(compareModuleVersions('   ', '1.0')).toBe('incomparable');
    });

    it('rejects a version string long enough not to be one', () => {
      expect(compareModuleVersions('1.'.repeat(50), '1.0')).toBe('incomparable');
    });

    it('rejects components too large to compare precisely', () => {
      expect(compareModuleVersions('99999999999999999999.0', '1.0')).toBe('incomparable');
    });
  });

  describe('non-string input', () => {
    it('does not throw on unexpected types', () => {
      expect(compareModuleVersions(42 as unknown as string, '1.0')).toBe('incomparable');
      expect(compareModuleVersions({} as unknown as string, '1.0')).toBe('incomparable');
    });
  });
});

describe('isUpgrade', () => {
  it('is true only for a provable upgrade', () => {
    expect(isUpgrade('2.0', '1.0')).toBe(true);
  });

  const notUpgrades: Array<[string | undefined, string | undefined, string]> = [
    ['1.0', '1.0', 'same version'],
    ['1.0', '2.0', 'older version'],
    ['20240115', '1.2', 'incomparable versions'],
    [undefined, '1.0', 'missing incoming version'],
    ['1.0', undefined, 'missing installed version'],
  ];
  it.each(notUpgrades)('is false for %s vs %s (%s)', (a, b) => {
    expect(isUpgrade(a, b)).toBe(false);
  });

  it('never treats an unorderable pair as an upgrade', () => {
    // The safety property the install policy depends on: if we cannot prove
    // the incoming module is newer, we must not overwrite what is on disk.
    const unorderable = [
      ['2024-01-15', '2023-06-01'],
      ['edition B', 'edition A'],
      ['1769', '1611'],
    ] as const;
    for (const [incoming, installed] of unorderable) {
      expect(isUpgrade(incoming, installed)).toBe(false);
    }
  });
});
