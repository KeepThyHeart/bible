/**
 * Characterization tests for the desktop reference parsers.
 *
 * The repo has three reference parsers with three different contracts:
 * core's `ReferenceParser`, `ui/utils/verseParser`, and this folder's
 * `verseReferenceParser`. When the shared book-name tables were consolidated
 * into `@bible/core`, a measured corpus showed core's parser diverging from
 * the two desktop ones in 26 of 51 inputs - so the tables were unified but the
 * parsing logic deliberately was not.
 *
 * These tests pin the differences that make that separation necessary. If a
 * future change makes a desktop parser agree with core on one of these, that is
 * a real behavioural change and should be a deliberate decision, not a silent
 * side effect of a refactor.
 */
import { describe, it, expect } from 'vitest';
import { ReferenceParser } from '@bible/core';
import { parseVerseReference } from '../utils/verseParser';
import { parseReference } from './verseReferenceParser';

const core = new ReferenceParser();

describe('verseParser rejects references core would accept', () => {
  // These are the reason verseParser is not a thin wrapper over core: it
  // validates the numbers, and core does not.
  it.each([
    ['John 0:1', 'chapter zero'],
    ['John 3:0', 'verse zero'],
    ['John 3:16-10', 'reversed verse range'],
  ])('rejects %s (%s)', (input) => {
    expect(parseVerseReference(input)).toBeUndefined();

    const viaCore = core.parse(input);
    expect(viaCore.isValid).toBe(true); // core would have accepted it
  });

  it.each([
    ['Genesus 1:1'],
    ['Rmoans 8:28'],
  ])('does not fuzzy-correct the typo %s', (input) => {
    expect(parseVerseReference(input)).toBeUndefined();
    expect(core.parse(input).fuzzyMatch).toBe(true); // core would have "corrected" it
  });
});

describe('verseReferenceParser supports shapes core does not', () => {
  it.each([
    ['John', 43],
    ['Jude', 65],
    ['Obadiah', 31],
  ])('parses the whole-book reference %s', (input, bookNumber) => {
    const parsed = parseReference(input);
    expect(parsed).not.toBeNull();
    expect(parsed!.book).toBe(bookNumber);
    expect(parsed!.isWholeBook).toBe(true);
  });

  it.each([
    ['Genesus 1:1'],
    ['Rmoans 8:28'],
  ])('does not fuzzy-correct the typo %s', (input) => {
    // This parser backs the copy and export dialogs, where silently rewriting
    // a mistyped book to a different one would corrupt the user's output.
    expect(parseReference(input)).toBeNull();
    expect(core.parse(input).fuzzyMatch).toBe(true);
  });
});

describe('shared book table', () => {
  // Both parsers now read core's alias table. These aliases existed in only one
  // of the copies before consolidation; all of them must resolve in both now.
  it.each([
    ['1sm 1:1', 9],
    ['2sm 1:1', 10],
    ['phlm 1:1', 57],
    ['rv 1:1', 66],
    ['1 sam 1:1', 9],
  ])('verseParser resolves the unioned alias %s', (input, bookNumber) => {
    const parsed = parseVerseReference(input);
    expect(parsed).toBeDefined();
    expect(parsed!.bookNumber).toBe(bookNumber);
  });

  it.each([
    ['revelations 1', 66],
    ['ii sam 3', 10],
    ['isamuel 1', 9],
  ])('verseReferenceParser resolves the unioned alias %s', (input, bookNumber) => {
    const parsed = parseReference(input);
    expect(parsed).not.toBeNull();
    expect(parsed!.book).toBe(bookNumber);
  });

  it('reports book names identical to core', () => {
    for (const [input, bookNumber] of [['John 3:16', 43], ['1 John 2:1', 62]] as const) {
      const parsed = parseVerseReference(input);
      expect(parsed!.bookName).toBe(core.getBookName(bookNumber));
    }
  });
});
