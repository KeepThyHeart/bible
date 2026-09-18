/**
 * Pure data-shaping for the Study pane's cross-reference, commentary, topic,
 * dictionary and book views.
 *
 * Each function turns the open library — plus a verse id, for the three
 * verse-scoped views — into rows a screen can draw — no rendering, no key
 * handling, no terminal — the same split `app/history.ts` makes, and for the
 * same reason: these can be exercised without a `Screen` or a fake terminal,
 * and `screens/Main.ts` owns every decision about how a row actually looks or
 * which key moves the cursor.
 *
 * Dictionaries and books are not verse-scoped: "Dictionaries (2)" is just an
 * installed count, and `d`/`k` are browsers (a letter index and a table of
 * contents) rather than lookups.
 *
 * A module that fails to answer (an unsupported schema, a corrupt row) is
 * treated as having nothing rather than allowed to throw — one broken module
 * should not blank the whole pane.
 */
import {
  decodeHtmlEntities,
  VerseIdHelper,
  type BookSection,
  type BookSectionSummary,
  type CommentaryEntry,
  type CrossReferenceGroupWithEntries,
  type DictionaryEntry,
  type Topic,
  type TopicVerse,
} from '@bible/core';

import type { Library, OpenBible, StudyModule } from './library';
import { toDisplayVerse } from './verseText';
import type { Theme } from '../term/style';

/** The two display flags that change how a quoted verse reads (`app/state.ts`'s `DisplaySettings`, minus what these functions do not need). */
export interface VerseTextOptions {
  readonly redLetter: boolean;
  readonly showSupplied: boolean;
}

// --- cross references -------------------------------------------------------

export interface CrossReferenceRow {
  readonly number: number;
  readonly label: string;
  readonly text: string;
  readonly targetVerseId: number;
}

export interface CrossReferenceGroupRows {
  /** The phrase this group is scoped to; `undefined` for a whole-verse group. */
  readonly phrase: string | undefined;
  readonly rows: readonly CrossReferenceRow[];
}

/**
 * Every cross reference on `verseId`, from every installed module, grouped by
 * phrase and numbered straight through: nothing here is collapsed, and there
 * is no per-module picker to choose first.
 */
export function crossReferenceGroups(
  library: Library,
  translation: string | undefined,
  verseId: number,
  theme: Theme,
  display: VerseTextOptions,
): readonly CrossReferenceGroupRows[] {
  const modules = library.study('cross_reference');
  if (modules.length === 0) return [];

  const groupsWithEntries = modules.flatMap((module) => safeGroupsWithEntries(module, verseId));
  if (groupsWithEntries.length === 0) return [];

  const bible = library.bible(translation);
  const targetIds = new Set<number>();
  for (const { entries } of groupsWithEntries) {
    for (const entry of entries) targetIds.add(entry.targetVerseId);
  }
  const texts = verseTextsPlain(bible, [...targetIds], theme, display);

  let number = 0;
  return groupsWithEntries.map(({ group, entries }) => ({
    phrase: group.phrase,
    rows: entries.map((entry) => {
      number += 1;
      return {
        number,
        label: crossReferenceLabel(library, verseId, entry.targetVerseId, entry.targetVerseEndId),
        text: texts.get(entry.targetVerseId) ?? '',
        targetVerseId: entry.targetVerseId,
      };
    }),
  }));
}

function safeGroupsWithEntries(
  module: StudyModule<'cross_reference'>,
  verseId: number,
): CrossReferenceGroupWithEntries[] {
  try {
    return module.repository.getGroupsWithEntries(verseId);
  } catch {
    return [];
  }
}

/**
 * `v17` when the target is in the chapter already on screen, `Romans 3:23`
 * otherwise.
 */
function crossReferenceLabel(
  library: Library,
  sourceVerseId: number,
  targetVerseId: number,
  targetEndVerseId: number | undefined,
): string {
  const source = VerseIdHelper.parse(sourceVerseId);
  const target = VerseIdHelper.parse(targetVerseId);
  const sameChapter = source.bookNumber === target.bookNumber && source.chapter === target.chapter;
  const end =
    targetEndVerseId === undefined || targetEndVerseId === targetVerseId
      ? undefined
      : VerseIdHelper.parse(targetEndVerseId);

  if (sameChapter) {
    if (end === undefined) return `v${target.verse}`;
    return end.bookNumber === target.bookNumber && end.chapter === target.chapter
      ? `v${target.verse}-${end.verse}`
      : `v${target.verse}…`;
  }

  const book = library.bookName(target.bookNumber);
  if (end === undefined) return `${book} ${target.chapter}:${target.verse}`;
  return end.bookNumber === target.bookNumber && end.chapter === target.chapter
    ? `${book} ${target.chapter}:${target.verse}-${end.verse}`
    : `${book} ${target.chapter}:${target.verse}…`;
}

// --- commentaries ------------------------------------------------------------

export interface CommentaryListRow {
  /** Fixed, alphabetical — not the library's discovery order. */
  readonly number: number;
  readonly abbreviation: string;
  readonly moduleName: string;
  readonly wordCount: number;
  /** Whether this commentary has anything on the verse; greyed out when false. */
  readonly hasEntry: boolean;
}

/**
 * Every installed commentary, alphabetically by abbreviation so a number
 * always names the same module — including the ones with
 * nothing on this verse, so the caller can grey them out rather than hide
 * them and shift every number after.
 */
export function commentaryListRows(library: Library, verseId: number): readonly CommentaryListRow[] {
  const modules = [...library.study('commentary')].sort((a, b) =>
    a.abbreviation.localeCompare(b.abbreviation, undefined, { sensitivity: 'base' }),
  );

  return modules.map((module, index) => {
    const entries = safeCommentaryEntries(module, verseId);
    const wordCount = entries.reduce((sum, entry) => sum + (entry.wordCount ?? countWords(entry.content)), 0);
    return {
      number: index + 1,
      abbreviation: module.abbreviation,
      moduleName: module.moduleName,
      wordCount,
      hasEntry: entries.length > 0,
    };
  });
}

function safeCommentaryEntries(module: StudyModule<'commentary'>, verseId: number): CommentaryEntry[] {
  try {
    return module.repository.getEntriesForVerse(verseId);
  } catch {
    return [];
  }
}

/**
 * The entry to show when a commentary has more than one covering the verse —
 * the narrowest wins, same rule (and reasoning) as `screens/Commentary.ts`'s
 * `bestEntry`: a module can carry both a chapter-level introduction and a
 * verse-level note, and "study this verse" wants the verse-level one.
 */
export function bestCommentaryEntry(
  module: StudyModule<'commentary'>,
  verseId: number,
): CommentaryEntry | undefined {
  const entries = safeCommentaryEntries(module, verseId);
  if (entries.length === 0) return undefined;

  return entries.reduce((best, entry) => {
    const span = (entry.verseIdEnd ?? entry.verseIdStart ?? 0) - (entry.verseIdStart ?? 0);
    const bestSpan = (best.verseIdEnd ?? best.verseIdStart ?? 0) - (best.verseIdStart ?? 0);
    return span < bestSpan ? entry : best;
  });
}

/** Word count for an entry whose module did not record one at import time. */
function countWords(html: string): number {
  const text = decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '));
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

// --- topics --------------------------------------------------------------

export interface TopicListRow {
  readonly number: number;
  readonly topicId: number;
  readonly moduleAbbreviation: string;
  readonly name: string;
  readonly verseCount: number;
}

/**
 * Every topic that has an entry for `verseId`, across every installed
 * topical-index module, alphabetically by name and numbered straight through
 * (the same "always the same number" reasoning as the commentary list: a
 * topic that moves position every time a module is added or removed would be
 * confusing).
 */
export function topicListRows(library: Library, verseId: number): readonly TopicListRow[] {
  const modules = library.study('topical_index');
  const seen = new Set<string>();
  const collected: { module: StudyModule<'topical_index'>; topic: Topic }[] = [];

  for (const module of modules) {
    for (const topic of safeTopicsForVerse(module, verseId)) {
      if (topic.topicId === undefined) continue;
      const key = `${module.abbreviation}:${topic.topicId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push({ module, topic });
    }
  }

  collected.sort((a, b) => a.topic.name.localeCompare(b.topic.name, undefined, { sensitivity: 'base' }));

  return collected.map(({ module, topic }, index) => ({
    number: index + 1,
    topicId: topic.topicId!,
    moduleAbbreviation: module.abbreviation,
    name: topic.name,
    verseCount: safeVerseCount(module, topic.topicId!),
  }));
}

function safeTopicsForVerse(module: StudyModule<'topical_index'>, verseId: number): Topic[] {
  try {
    return module.repository.getTopicsByVerse(verseId);
  } catch {
    return [];
  }
}

function safeVerseCount(module: StudyModule<'topical_index'>, topicId: number): number {
  try {
    return module.repository.getVerseCount(topicId);
  } catch {
    return 0;
  }
}

export interface TopicVerseRow {
  readonly number: number;
  readonly label: string;
  readonly text: string;
  readonly targetVerseId: number;
}

/**
 * The verses filed under one topic, with their text — shown inline because a
 * terminal user can't hover for it.
 */
export function topicVerseRows(
  library: Library,
  translation: string | undefined,
  moduleAbbreviation: string,
  topicId: number,
  theme: Theme,
  display: VerseTextOptions,
): readonly TopicVerseRow[] {
  const module = library.studyModule('topical_index', moduleAbbreviation);
  if (module === undefined) return [];

  const verses = safeVersesForTopic(module, topicId);
  if (verses.length === 0) return [];

  const bible = library.bible(translation);
  const texts = verseTextsPlain(
    bible,
    verses.map((v) => v.verseIdStart),
    theme,
    display,
  );

  return verses.map((v, index) => ({
    number: index + 1,
    label: fullReferenceLabel(library, v.verseIdStart, v.verseIdEnd === v.verseIdStart ? undefined : v.verseIdEnd),
    text: texts.get(v.verseIdStart) ?? '',
    targetVerseId: v.verseIdStart,
  }));
}

function safeVersesForTopic(module: StudyModule<'topical_index'>, topicId: number): TopicVerse[] {
  try {
    return module.repository.getVersesForTopic(topicId);
  } catch {
    return [];
  }
}

/** `John 3:16`, or `John 3:16-18` for a range — always the full book name, never the "v17" shorthand. */
function fullReferenceLabel(library: Library, startVerseId: number, endVerseId: number | undefined): string {
  const start = VerseIdHelper.parse(startVerseId);
  const book = library.bookName(start.bookNumber);
  if (endVerseId === undefined) return `${book} ${start.chapter}:${start.verse}`;

  const end = VerseIdHelper.parse(endVerseId);
  return end.bookNumber === start.bookNumber && end.chapter === start.chapter
    ? `${book} ${start.chapter}:${start.verse}-${end.verse}`
    : `${book} ${start.chapter}:${start.verse}…`;
}

// --- dictionaries --------------------------------------------------------

export interface DictionaryListRow {
  readonly number: number;
  readonly abbreviation: string;
  readonly moduleName: string;
  readonly entryCount: number;
}

/**
 * Every installed dictionary, alphabetically by abbreviation — same "always
 * the same number" reasoning as {@link commentaryListRows}. `d` is a browser,
 * not a verse-scoped lookup: "Dictionaries (2)" just means two are installed,
 * not that two have something for the cursor verse — so unlike the commentary
 * and topic lists, nothing here reads `verseId`.
 */
export function dictionaryListRows(library: Library): readonly DictionaryListRow[] {
  const modules = [...library.study('dictionary')].sort((a, b) =>
    a.abbreviation.localeCompare(b.abbreviation, undefined, { sensitivity: 'base' }),
  );
  return modules.map((module, index) => ({
    number: index + 1,
    abbreviation: module.abbreviation,
    moduleName: module.moduleName,
    entryCount: safeEntryCount(module),
  }));
}

function safeEntryCount(module: StudyModule<'dictionary'>): number {
  try {
    return module.repository.getEntryCount();
  } catch {
    return 0;
  }
}

export interface DictionaryLetterRow {
  readonly number: number;
  readonly letter: string;
  readonly count: number;
}

/** A dictionary's letter index (`IDictionaryRepository.getLetterIndex`), numbered for the picker. */
export function dictionaryLetterRows(library: Library, abbreviation: string): readonly DictionaryLetterRow[] {
  const module = library.studyModule('dictionary', abbreviation);
  if (module === undefined) return [];
  return safeLetterIndex(module).map((entry, index) => ({
    number: index + 1,
    letter: entry.letter,
    count: entry.count,
  }));
}

function safeLetterIndex(module: StudyModule<'dictionary'>): Array<{ letter: string; count: number }> {
  try {
    return module.repository.getLetterIndex();
  } catch {
    return [];
  }
}

export interface DictionaryEntryListRow {
  readonly number: number;
  readonly entryKey: string;
  readonly word: string;
}

export interface DictionaryEntryList {
  readonly rows: readonly DictionaryEntryListRow[];
  readonly total: number;
}

/**
 * A generous cap on one letter's browse page. No installed dictionary comes
 * close in practice, including a Strong's module's numeric "G"/"H" buckets
 * (a few thousand entries each) — see `screens/Main.ts`'s widened 4-digit
 * picker buffer for this view, which is what actually makes an entry past #99
 * reachable.
 */
const DICTIONARY_LETTER_PAGE = 9999;

/** Every entry under one letter, in entry-key order (`browseByLetter`), numbered for the picker. */
export function dictionaryEntryRows(
  library: Library,
  abbreviation: string,
  letter: string,
): DictionaryEntryList {
  const module = library.studyModule('dictionary', abbreviation);
  if (module === undefined) return { rows: [], total: 0 };

  const { entries, total } = safeBrowseByLetter(module, letter);
  return {
    rows: entries.map((entry, index) => ({
      number: index + 1,
      entryKey: entry.entryKey,
      word: entry.word.length > 0 ? entry.word : entry.entryKey,
    })),
    total,
  };
}

function safeBrowseByLetter(
  module: StudyModule<'dictionary'>,
  letter: string,
): { entries: Array<{ entryKey: string; word: string }>; total: number } {
  try {
    return module.repository.browseByLetter(letter, DICTIONARY_LETTER_PAGE, 0);
  } catch {
    return { entries: [], total: 0 };
  }
}

/** One dictionary entry, by key — the reading view a row in {@link dictionaryEntryRows} opens. */
export function dictionaryEntry(
  library: Library,
  abbreviation: string,
  entryKey: string,
): DictionaryEntry | undefined {
  const module = library.studyModule('dictionary', abbreviation);
  if (module === undefined) return undefined;
  try {
    return module.repository.getEntryByKey(entryKey);
  } catch {
    return undefined;
  }
}

// --- books -----------------------------------------------------------------

export interface BookListRow {
  readonly number: number;
  readonly abbreviation: string;
  readonly moduleName: string;
}

/**
 * Every installed book module, alphabetically — `k` is a table-of-contents
 * browser, not verse-scoped: the count is installed modules, not "sections
 * citing this verse".
 */
export function bookListRows(library: Library): readonly BookListRow[] {
  const modules = [...library.study('book')].sort((a, b) =>
    a.abbreviation.localeCompare(b.abbreviation, undefined, { sensitivity: 'base' }),
  );
  return modules.map((module, index) => ({
    number: index + 1,
    abbreviation: module.abbreviation,
    moduleName: module.moduleName,
  }));
}

export interface BookSectionRow {
  readonly number: number;
  readonly sectionId: number;
  readonly title: string;
  readonly hasChildren: boolean;
}

/**
 * One level of a book's table of contents. `parentSectionId` is `undefined`
 * for the top level, or a section's id to list its children —
 * `screens/Main.ts` keeps a stack of the ids it has drilled into, so `esc`
 * can walk back out one level at a time.
 *
 * Reads `getAllSectionSummaries()` once rather than `getTopLevelSections` /
 * `getSectionsByParent`, so `hasChildren` — needed to decide whether a number
 * opens another list or the section itself — comes from the one query's
 * `child_count` instead of an extra call per row.
 */
export function bookSectionRows(
  library: Library,
  abbreviation: string,
  parentSectionId: number | undefined,
): readonly BookSectionRow[] {
  const module = library.studyModule('book', abbreviation);
  if (module === undefined) return [];

  const summaries = safeSectionSummaries(module).filter((s) => s.parentSectionId === parentSectionId);
  return summaries.map((summary, index) => ({
    number: index + 1,
    sectionId: summary.sectionId,
    title: summary.title,
    hasChildren: summary.hasChildren ?? false,
  }));
}

function safeSectionSummaries(module: StudyModule<'book'>): BookSectionSummary[] {
  try {
    return module.repository.getAllSectionSummaries();
  } catch {
    return [];
  }
}

/** One book section's full content, by id — the reading view a leaf row in {@link bookSectionRows} opens. */
export function bookSection(library: Library, abbreviation: string, sectionId: number): BookSection | undefined {
  const module = library.studyModule('book', abbreviation);
  if (module === undefined) return undefined;
  try {
    return module.repository.getSection(sectionId);
  } catch {
    return undefined;
  }
}

// --- shared ------------------------------------------------------------------

/**
 * Target verse text, in one query, with the module's own formatting applied.
 *
 * `toDisplayVerse` rather than the raw column so the divine name is
 * uppercased here exactly as it is in the reader. Only the characters are kept: neither list paints
 * anything but its own selection highlight.
 */
function verseTextsPlain(
  bible: OpenBible | undefined,
  verseIds: readonly number[],
  theme: Theme,
  display: VerseTextOptions,
): Map<number, string> {
  const out = new Map<number, string>();
  if (bible === undefined || verseIds.length === 0) return out;

  for (const [verseId, verse] of bible.repo.getVerseTexts([...verseIds])) {
    const displayed = toDisplayVerse(verse, {
      theme,
      redLetter: display.redLetter,
      showSupplied: display.showSupplied,
    });
    out.set(verseId, displayed.plainText);
  }
  return out;
}
