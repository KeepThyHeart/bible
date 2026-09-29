/**
 * Keyword marks (task 0065): the data model.
 *
 * A keyword *set* holds *rules* (word forms, a phrase, Strong's numbers or a
 * connective category) plus a style per mark. Sets are matched against whatever
 * chapter and translation is on screen at render time; no positions are stored.
 */

export const MARK_COLOR_KEYS = [
  'mark.1', 'mark.2', 'mark.3', 'mark.4', 'mark.5', 'mark.6', 'mark.7', 'mark.8',
] as const;
export type MarkColorKey = (typeof MARK_COLOR_KEYS)[number];

/** Closed list of badge symbols (generic; not any published method's symbol set). */
export const MARK_SYMBOLS = ['∴', '∵', '⇄', '→', '✚', '◆', '●', '▲', '■', '★', '†', '?'] as const;
export type MarkSymbol = (typeof MARK_SYMBOLS)[number];

export const MARK_LINES = ['solid', 'dashed', 'dotted', 'thick', 'none'] as const;
export type MarkLine = (typeof MARK_LINES)[number];

export const CONNECTIVE_CATEGORIES = [
  'inference', 'reason', 'contrast', 'purpose', 'condition', 'comparison', 'time',
] as const;
export type ConnectiveCategory = (typeof CONNECTIVE_CATEGORIES)[number];

export type MatchRule =
  /** Any of these word forms ("love, loved, loveth"). A form with spaces is a phrase. */
  | { kind: 'word'; forms: string[]; matchCase?: boolean }
  /** Consecutive words inside one verse ("so that", "kingdom of God"). */
  | { kind: 'phrase'; text: string; matchCase?: boolean }
  /** Interlinear Strong's numbers, e.g. ["G4102"]. Needs interlinear rows. */
  | { kind: 'strongs'; numbers: string[] }
  /** A connective category, resolved through the per-language lexicon. */
  | { kind: 'connective'; category: ConnectiveCategory };

export interface MarkStyle {
  color: MarkColorKey;
  /** Underline style (default 'solid'); 'none' draws no underline. */
  line: MarkLine;
  /** Optional background tint, off by default so user highlights stay readable. */
  fill?: 'subtle';
  bold?: boolean;
  /** Rendered as a small badge after the word. */
  symbol?: MarkSymbol;
}

export interface KeywordMark {
  id: string;
  label: string;
  rule: MatchRule;
  style: MarkStyle;
  enabled: boolean;
  note?: string;
}

export type KeywordScope =
  | { kind: 'everywhere' }
  | { kind: 'books'; books: number[] }
  | { kind: 'passage'; start: number; end: number };

export interface KeywordSet {
  schema: 1;
  id: string;
  name: string;
  /** BCP 47 tag; word/phrase/connective rules apply only to modules in this language. */
  language?: string;
  scope: KeywordScope;
  marks: KeywordMark[];
  /** Set for shipped sets, e.g. 'connectives-en'. Read-only: duplicate to edit. */
  builtIn?: string;
  updatedAt: string;
}

export interface ChapterVerseInput {
  verseId: number;
  words: { text: string }[];
}

export interface InterlinearSpan {
  verseId: number;
  /** English word index range, 0-based inclusive. */
  start: number;
  end: number;
  strongs?: string;
  morph?: string;
}

export interface ChapterInput {
  moduleId: number;
  /** BCP 47 language of the module's text. */
  language: string;
  verses: ChapterVerseInput[];
  interlinear?: InterlinearSpan[];
}

export interface MarkHit {
  markId: string;
  /** English word index range, 0-based inclusive. */
  start: number;
  end: number;
  /** Surface-form match of a connective with no interlinear anchor ("approximate"). */
  loose?: boolean;
}

export interface MarkCount {
  hits: number;
  verses: number[];
}

export interface MatchResult {
  byVerse: Map<number, MarkHit[]>;
  counts: Map<string, MarkCount>;
  /** A Strong's rule is active but no interlinear rows were supplied. */
  needsInterlinear: boolean;
  /** An anchored connective could use interlinear rows (else it falls back to loose surface matching). */
  wantsInterlinear: boolean;
}

export interface KeywordSuggestion {
  label: string;
  rule: MatchRule;
  count: number;
  verses: number[];
}

export interface KeywordValidationError {
  path: string;
  message: string;
}
