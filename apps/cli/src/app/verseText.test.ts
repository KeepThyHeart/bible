/**
 * Verse spans become terminal appearance.
 *
 * The tests that matter run against the *real* KJV rather than a fixture,
 * because the thing being verified is that this code reads the spans a shipped
 * module actually carries. A hand-built verse would only prove the code agrees
 * with the test's idea of the format.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { BibleRepository, BibleVerse } from '@bible/core';

import { BunSql } from '../data/BunSql';
import { createTheme } from '../term/style';
import { toDisplayVerse } from './verseText';

const MODULES = join(import.meta.dir, '..', '..', '..', '..', 'data', 'modules');
const KJV = join(MODULES, 'bible_kjv.db');
const hasKjv = existsSync(KJV);

const theme = createTheme('ansi256');
const options = { theme, redLetter: true, showSupplied: true } as const;

/** John 3:16 — `paragraph_start`, and words of Christ over the whole verse. */
const JOHN_3_16 = 43003016;
/** Genesis 2:4 — one `divine_name` word and one `supplied` word. */
const GENESIS_2_4 = 1002004;
/** Psalm 3:1 — carries a psalm title in `formatting.block.heading`. */
const PSALM_3_1 = 19003001;

function fromKjv(verseId: number): BibleVerse {
  const sql = new BunSql(KJV, { readonly: true, immutable: true });
  try {
    const verse = new BibleRepository(sql).getVerse(verseId);
    if (verse === undefined) throw new Error(`${verseId} not in the KJV`);
    return verse;
  } finally {
    sql.close();
  }
}

describe('spans from the real KJV', () => {
  test.skipIf(!hasKjv)('words of Christ are coloured and cover the whole of John 3:16', () => {
    const display = toDisplayVerse(fromKjv(JOHN_3_16), options);
    expect(display.verse).toBe(16);
    expect(display.paragraphStart).toBe(true);
    expect(display.plainText).toStartWith('For God so loved the world');

    const red = display.runs.filter((run) => run.style === theme.wordsOfChrist);
    expect(red.length).toBeGreaterThan(0);
    expect(red.map((r) => r.text).join(' ')).toContain('everlasting life');
  });

  test.skipIf(!hasKjv)('red letter off leaves the text alone', () => {
    const display = toDisplayVerse(fromKjv(JOHN_3_16), { ...options, redLetter: false });
    for (const run of display.runs) expect(run.style).toBeUndefined();
    // Turning the colour off must not change a single character.
    expect(display.plainText).toBe(toDisplayVerse(fromKjv(JOHN_3_16), options).plainText);
  });

  test.skipIf(!hasKjv)('a divine name is uppercased, not merely styled', () => {
    // The stored text reads `Lord`. Every printed KJV reads `LORD`, and a
    // terminal has no small caps, so uppercase is the only faithful rendering.
    // Leaving it alone would silently lose the distinction between the divine
    // name and the title.
    const raw = fromKjv(GENESIS_2_4);
    expect(raw.text).toContain('Lord');

    const display = toDisplayVerse(raw, options);
    expect(display.plainText).toContain('LORD');
    expect(display.plainText).not.toMatch(/\bLord\b/);
  });

  test.skipIf(!hasKjv)('supplied words are italic and nothing else', () => {
    const display = toDisplayVerse(fromKjv(GENESIS_2_4), options);
    const italic = display.runs.filter((run) => run.style === theme.supplied);
    expect(italic.length).toBeGreaterThan(0);
    for (const run of italic) expect(run.style?.italic).toBe(true);
  });

  test.skipIf(!hasKjv)('supplied words off drops the style but keeps the words', () => {
    const on = toDisplayVerse(fromKjv(GENESIS_2_4), options);
    const off = toDisplayVerse(fromKjv(GENESIS_2_4), { ...options, showSupplied: false });
    expect(off.plainText).toBe(on.plainText);
    expect(off.runs.some((run) => run.style === theme.supplied)).toBe(false);
  });

  test.skipIf(!hasKjv)('a psalm title comes through as a heading', () => {
    const display = toDisplayVerse(fromKjv(PSALM_3_1), options);
    expect(display.heading).toContain('Psalm of David');
  });

  test.skipIf(!hasKjv)('the runs reassemble into exactly the stored text', () => {
    // The reader lays out `runs`; copy and search use `plainText`. If the two
    // ever disagree, what you copy is not what you read.
    const raw = fromKjv(JOHN_3_16);
    const display = toDisplayVerse(raw, options);
    expect(display.runs.map((r) => r.text).join(' ')).toBe(display.plainText);
    expect(display.plainText).toBe(raw.text);
  });
});

describe('spans in isolation', () => {
  function synthetic(text: string, spans: Array<{ type: string; start: number; end: number }>) {
    return new BibleVerse({
      verseId: JOHN_3_16,
      text,
      formatting: { v: 1, spans: spans as never },
    });
  }

  test('a word that is both supplied and spoken by Christ keeps both', () => {
    // Merged rather than replaced: dropping either would lose real information.
    const display = toDisplayVerse(
      synthetic('alpha beta gamma', [
        { type: 'words_of_christ', start: 0, end: 2 },
        { type: 'supplied', start: 1, end: 1 },
      ]),
      options,
    );
    const beta = display.runs.find((run) => run.text === 'beta');
    expect(beta?.style?.italic).toBe(true);
    expect(beta?.style?.fg).toBe(theme.wordsOfChrist.fg);
  });

  test('a span running past the end of the verse does not throw', () => {
    // Span offsets come from a module file, which the CLI does not control.
    const display = toDisplayVerse(
      synthetic('alpha beta', [{ type: 'words_of_christ', start: 0, end: 99 }]),
      options,
    );
    expect(display.plainText).toBe('alpha beta');
  });

  test('a verse with no spans is a single run', () => {
    const display = toDisplayVerse(synthetic('alpha beta gamma', []), options);
    expect(display.runs).toHaveLength(1);
    expect(display.runs[0]!.style).toBeUndefined();
  });
});
