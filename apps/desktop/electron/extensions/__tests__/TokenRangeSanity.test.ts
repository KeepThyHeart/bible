/**
 * A5 sanity check (task 0036, P0.1b; design doc §4.3/§16, amendment A5).
 *
 * Amendment A5 replaces design §4.3's two-signal offset-matcher with a direct
 * claim: `kind: 'tokens'` resolves to rendered word indexes
 * `startTokenIndex..endTokenIndex` directly, because `interlinear_word.
 * word_position_*` already indexes the same English word sequence
 * `extractWordsWithFormatting(text_html)` produces. That claim is only as
 * good as its empirical check (design doc's own words: "this cannot be
 * settled from the types"), so this test verifies it against a REAL module
 * database rather than a hand-built fixture: every interlinear word's
 * `wordPositionStart`/`wordPositionEnd` - the same values
 * `bible.getTokensForRange` (`BibleBridge.getTokensForRange`,
 * `IBibleRepository.getInterlinearWordsForRange`) hands back as
 * `VerseTokenDto.index` - must fall inside the word count
 * `extractWordsWithFormatting` produces for that same verse's rendered HTML.
 *
 * Gated on real module data exactly like `packages/core`'s `KJVTestHelper`/
 * `testDataAvailable` pattern: module databases are deployment content, not
 * repo content, so this SKIPS (loudly, via `console.warn`) rather than fails
 * when `BIBLE_DATA_DIR` (or the repo-root `data/` fallback) has no `kjv`
 * module. `apps/desktop` doesn't reach into `packages/core`'s private test
 * helpers (`src/__tests__/helpers/*` isn't part of its public surface), so
 * the same small amount of path-resolution logic is duplicated here rather
 * than imported across the package boundary.
 *
 * The design doc asks this be checked against "kjv Gen 1 and one Greek
 * module" - kjv is exercised below. No original-language (Hebrew/Greek)
 * module shipped with this repo's sample data set when this test was
 * written (only `bible_kjv.db` and `bible_asv.db`, both English, were
 * present) - the Greek half is gated separately on
 * `module_info.is_original_language` and SKIPS with its own warning rather
 * than silently reporting success when none is found. This is called out as
 * an open item in the delivery message, not silently resolved.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import Database from 'better-sqlite3-multiple-ciphers';
import { BibleRepository, VerseIdHelper, formatVerseText, type BibleVerse } from '@bible/core';
import { SqliteProvider } from '../../providers/SqliteProvider';
import { extractWordsWithFormatting } from '@bible/core/browser';

const DATA_DIR = process.env.BIBLE_DATA_DIR
  ? resolve(process.env.BIBLE_DATA_DIR)
  : resolve(__dirname, '../../../../../data');
const MODULES_DIR = process.env.BIBLE_MODULES_DIR ? resolve(process.env.BIBLE_MODULES_DIR) : DATA_DIR;
const MODULES_SUBDIR = resolve(MODULES_DIR, 'modules');
const KJV_DB_PATH = resolve(MODULES_SUBDIR, 'bible_kjv.db');

function warnSkip(suite: string, reason: string): void {
  console.warn(
    `\n[apps/desktop] SKIPPING "${suite}" - ${reason}\n` +
      `  This suite checks amendment A5's real-data assumption, so that coverage did NOT run.\n` +
      `  Set BIBLE_DATA_DIR to a populated data directory to enable it.\n`,
  );
}

const kjvAvailable = existsSync(KJV_DB_PATH);
if (!kjvAvailable) warnSkip('A5 sanity check (kjv)', `kjv module not found at:\n    ${KJV_DB_PATH}`);

/**
 * Every rendered-word bound violation this run found, keyed by verse id -
 * collected instead of failing on the first mismatch, so a real problem
 * (rather than one off-by-one on one verse) is visible in full.
 */
interface Violation {
  verseId: number;
  tokenIndex: number;
  wordPositionStart: number;
  wordPositionEnd: number;
  renderedWordCount: number;
}

function checkModuleAgainstRenderedWords(dbPath: string, startVerseId: number, endVerseId: number): {
  versesChecked: number;
  tokensChecked: number;
  violations: Violation[];
} {
  const sql = new SqliteProvider(dbPath, { readonly: true });
  try {
    const repo = new BibleRepository(sql);
    if (!repo.hasInterlinearData()) {
      return { versesChecked: 0, tokensChecked: 0, violations: [] };
    }
    const tokensByVerse = repo.getInterlinearWordsForRange(startVerseId, endVerseId);
    const violations: Violation[] = [];
    let versesChecked = 0;
    let tokensChecked = 0;
    for (const [verseId, tokens] of tokensByVerse) {
      const verse: BibleVerse | undefined = repo.getVerse(verseId);
      if (!verse) continue;
      const html = formatVerseText(verse).textHtml;
      const words = extractWordsWithFormatting(html);
      versesChecked++;
      tokens.forEach((token, tokenIndex) => {
        tokensChecked++;
        const inBounds =
          token.wordPositionStart >= 0 &&
          token.wordPositionEnd < words.length &&
          token.wordPositionStart <= token.wordPositionEnd;
        if (!inBounds) {
          violations.push({
            verseId,
            tokenIndex,
            wordPositionStart: token.wordPositionStart,
            wordPositionEnd: token.wordPositionEnd,
            renderedWordCount: words.length,
          });
        }
      });
    }
    return { versesChecked, tokensChecked, violations };
  } finally {
    sql.close();
  }
}

describe.skipIf(!kjvAvailable)('A5 sanity check - kind:"tokens" indexes fall inside the rendered word count', () => {
  it('kjv Genesis 1: every interlinear word position is within extractWordsWithFormatting()\'s word count', () => {
    const range = VerseIdHelper.getChapterRange(1, 1); // Genesis 1
    const endVerseId = range.endVerseId ?? range.startVerseId;
    const { versesChecked, tokensChecked, violations } = checkModuleAgainstRenderedWords(
      KJV_DB_PATH,
      range.startVerseId,
      endVerseId,
    );

    // Fails loudly (not a silent pass) if kjv turns out to have no
    // interlinear data or Genesis 1 resolves to nothing - either would mean
    // this test checked nothing, same as the suite it's modeled on.
    expect(versesChecked).toBeGreaterThan(0);
    expect(tokensChecked).toBeGreaterThan(0);

    if (violations.length > 0) {
      console.error(
        `A5 sanity check: ${violations.length}/${tokensChecked} kjv Genesis 1 tokens fall ` +
          `outside the rendered word count:\n${violations
            .slice(0, 20)
            .map(
              (v) =>
                `  verse ${v.verseId} token ${v.tokenIndex}: word_position ${v.wordPositionStart}-${v.wordPositionEnd}, rendered word count ${v.renderedWordCount}`,
            )
            .join('\n')}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('finds and checks any original-language (Hebrew/Greek) module in the data set, or skips with a warning', () => {
    if (!existsSync(MODULES_SUBDIR)) {
      warnSkip('A5 sanity check (original-language module)', `modules directory not found at:\n    ${MODULES_SUBDIR}`);
      return;
    }
    const candidates = readdirSync(MODULES_SUBDIR).filter((f) => f.startsWith('bible_') && f.endsWith('.db'));
    let originalLanguageDb: string | null = null;
    for (const file of candidates) {
      const path = resolve(MODULES_SUBDIR, file);
      const raw = new Database(path, { readonly: true });
      try {
        const row = raw.prepare('SELECT is_original_language FROM module_info LIMIT 1').get() as
          | { is_original_language: number }
          | undefined;
        if (row?.is_original_language) {
          originalLanguageDb = path;
          break;
        }
      } catch {
        // Not a Bible module DB (or an unreadable one) - skip it, don't fail the search.
      } finally {
        raw.close();
      }
    }

    if (!originalLanguageDb) {
      warnSkip(
        'A5 sanity check (original-language module)',
        `no module with module_info.is_original_language=1 found under:\n    ${MODULES_SUBDIR}\n` +
          `  (checked: ${candidates.join(', ') || '<none>'})`,
      );
      return;
    }

    const sql = new SqliteProvider(originalLanguageDb, { readonly: true });
    let firstBookNumber: number | undefined;
    try {
      const row = sql.queryOne<{ verse_id: number }>('SELECT MIN(verse_id) as verse_id FROM bible_verse');
      firstBookNumber = row ? Math.floor(row.verse_id / 1_000_000) : undefined;
    } finally {
      sql.close();
    }
    expect(firstBookNumber).toBeDefined();
    if (firstBookNumber === undefined) return;

    const range = VerseIdHelper.getChapterRange(firstBookNumber, 1);
    const endVerseId = range.endVerseId ?? range.startVerseId;
    const { versesChecked, tokensChecked, violations } = checkModuleAgainstRenderedWords(
      originalLanguageDb,
      range.startVerseId,
      endVerseId,
    );
    expect(versesChecked).toBeGreaterThan(0);
    expect(tokensChecked).toBeGreaterThan(0);
    if (violations.length > 0) {
      console.error(
        `A5 sanity check: ${violations.length}/${tokensChecked} tokens in ${originalLanguageDb} fall outside the rendered word count.`,
      );
    }
    expect(violations).toEqual([]);
  });
});
