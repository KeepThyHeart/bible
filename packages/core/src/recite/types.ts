/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Recitation contracts. Pure types, QuickJS-safe: the only import is a type
 * import from ../speech/types.
 */

import type { RecognizedWord } from '../speech/types';

export type WordVerdict = 'correct' | 'variant' | 'near' | 'swapped' | 'wrong' | 'missed' | 'hinted';

export interface AlignedWord {
  /** Index of the expected word. */
  index: number;
  verdict: WordVerdict;
  /** The heard surface text matched to this word, if any. */
  heard?: string;
  credit: number;
  /** Index into the heard words that matched. */
  heardIndex?: number;
}

export interface RecitationResult {
  /** One per expected word, in order. */
  words: AlignedWord[];
  /** Inserted words, fillers and commands excluded. */
  extras: { afterIndex: number; heard: string }[];
  /** 0..1, the same scale as session scoring. */
  score: number;
  verseScores: number[];
  /** Last expected index with a non-missed verdict, -1 if none. */
  lastMatched: number;
}

export type Strictness = 'lenient' | 'normal' | 'strict';

export interface ScoringPolicy {
  strictness: Strictness;
  credit: Record<WordVerdict, number>;
  extraPenalty: number;
  /** Extras never cost more than this fraction of the passage. */
  extraCap: number;
  /** Confidence below this upgrades near to variant (off when strict). */
  lowConfidence: number;
}

export type LoopCommand = 'hint' | 'repeat' | 'skip' | 'again' | 'stop' | 'resume' | 'where';

export type BiasLevel = 'none' | 'names' | 'vocabulary' | 'full';

export interface IPronouncer {
  /** ARPAbet phonemes without stress. */
  phonemes(word: string): readonly string[];
}

export interface HeardToken {
  text: string;
  /** Normalised form. */
  norm: string;
  /** Index into the original RecognizedWord[]. */
  heardIndex: number;
  confidence?: number;
  /** Expanded from digits. */
  fromNumber?: boolean;
}

/** One per language; 'en' first. */
export interface ILanguageKit {
  language: string;
  /** Recognised words to tokens: digits to words, split hyphens, fold case. */
  spokenTokens(text: string): string[];
  /** Verse words to folded targets. */
  targetTokens(verseWords: string[]): string[];
  equivalent(a: string, b: string): 'equal' | 'variant' | null;
  /** Archaic or inflection pairs such as believeth / believes. */
  archaicNear(a: string, b: string): boolean;
  pronouncer: IPronouncer;
  fillers: ReadonlySet<string>;
  commands: Record<string, LoopCommand>;
  isStopword(w: string): boolean;
}

export type { RecognizedWord };
