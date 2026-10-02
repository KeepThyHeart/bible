import { describe, it, expect, beforeAll } from 'vitest';
import { ReferenceEngine } from '../engine';
import { loadReferenceLocales } from '../registry';
import type { BookNameStyle } from '../types';
import { LOCALE_TAGS } from './helpers';

const STYLES: BookNameStyle[] = ['long', 'medium', 'short'];

/**
 * Forms that legitimately do not round-trip because the abbreviation is
 * ambiguous within the locale. Key: `${tag}:${style}:${book}`.
 * (Filled in after running; each entry must have a comment.)
 */
const KNOWN_COLLISIONS: Record<string, string> = {};

describe('format -> parse round trip', () => {
  beforeAll(async () => {
    await loadReferenceLocales([...LOCALE_TAGS]);
  });

  for (const tag of LOCALE_TAGS) {
    for (const style of STYLES) {
      it(`${tag} ${style}: every book 1..66`, () => {
        // Only this locale: no English, so a failure is the locale's own.
        const engine = ReferenceEngine.create({ locales: [tag] });
        const failures: string[] = [];
        const tolerated: string[] = [];
        for (let book = 1; book <= 66; book++) {
          const text = engine.format({ book, chapter: 1, verse: 1 }, { style });
          const res = engine.parse(text);
          const ok =
            res.ok && res.ranges[0].book === book && res.ranges[0].chapter === 1 && res.ranges[0].verse === 1;
          if (ok) continue;
          const got = res.ok ? `${res.ranges[0].book}:${res.ranges[0].chapter}:${res.ranges[0].verse}` : `fail(${res.reason})`;
          const line = `${book} "${text}" -> ${got}`;
          if (KNOWN_COLLISIONS[`${tag}:${style}:${book}`]) tolerated.push(line);
          else failures.push(line);
        }
        if (tolerated.length) console.info(`${tag} ${style} tolerated collisions:\n  ${tolerated.join('\n  ')}`);
        expect(failures).toEqual([]);
      });
    }
  }
});
