import { describe, it, expect } from 'vitest';
import { formatAppLink, isAppHash, parseAppLink } from './AppLink';

describe('parseAppLink / formatAppLink', () => {
  it('parses hash and uri forms', () => {
    expect(parseAppLink('#/@present')).toEqual({ segment: 'present', route: '' });
    expect(parseAppLink('/@present/a/b')).toEqual({ segment: 'present', route: 'a/b' });
    expect(parseAppLink('app:present/a')).toEqual({ segment: 'present', route: 'a' });
    expect(parseAppLink('#/@ext.kth.bible-memory.memorize/due')).toEqual({
      segment: 'ext.kth.bible-memory.memorize',
      route: 'due',
    });
    expect(parseAppLink('#/@present/')).toEqual({ segment: 'present', route: '' });
  });

  it('rejects Study hashes and malformed links', () => {
    for (const bad of ['#/KJV/43/3', '', '#', '#/@', '#/@/x', '#/@Present', '#/@a..b', '#/@-x', 'app:', '#/@p/%E0%A4%A']) {
      expect(parseAppLink(bad)).toBeNull();
    }
    expect(parseAppLink(undefined)).toBeNull();
  });

  it('round-trips routes with reserved characters', () => {
    const routes = ['', 'a', 'a/b/c', 'Psalm 23:1-6', 'q?x=1&y=#z', 'ünï/çødé', '100%'];
    for (const route of routes) {
      for (const scheme of ['hash', 'uri'] as const) {
        const link = formatAppLink('present', route, scheme);
        expect(parseAppLink(link)).toEqual({ segment: 'present', route });
      }
    }
    expect(formatAppLink('present')).toBe('#/@present');
    expect(formatAppLink('present', '/a//b/', 'uri')).toBe('app:present/a/b');
  });

  it('refuses to format an invalid segment', () => {
    expect(() => formatAppLink('Bad Id')).toThrow();
  });

  it('isAppHash', () => {
    expect(isAppHash('#/@present')).toBe(true);
    expect(isAppHash('#/KJV/1/1')).toBe(false);
  });
});
