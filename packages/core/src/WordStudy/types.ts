/**
 * Word study DTOs and the provider seam. Pure types: safe for both apps and
 * for the browser bundle. The service that produces them is
 * `Services/WordStudyService` (Node side).
 */

import type { WordGroup } from './wordGroup';
import type { RenderingGroup, RenderingMode } from './renderings';

/**
 * What is being studied. A Strong's number (original-language study, needs a
 * Strong's-tagged module) or a word group (any translation's own text).
 */
export type WordStudySubject =
  | { kind: 'strongs'; strongs: string }
  | { kind: 'group'; group: WordGroup };

export interface WordStudyOptions {
  /** Bible module abbreviation the study describes. Default: the first suitable installed module. */
  module?: string;
  /** How renderings are grouped (Strong's studies only). Default 'head'. */
  renderingMode?: RenderingMode;
}

export interface WordKeyCandidate {
  strongs: string;
  language: 'Greek' | 'Hebrew';
  word?: string;
  translit?: string;
  gloss: string;
}

export interface WordStudyModuleInfo {
  module: string;
  name: string;
  languageCode?: string;
  /** Strong's studies: occurrences in this module. Group studies: omitted. */
  occurrences?: number;
  verses?: number;
  testament?: 'OT' | 'NT' | 'both';
  /** True when the module carries Strong's tagging (interlinear_word). */
  strongsTagged: boolean;
}

export interface WordStudyEntry {
  word?: string;
  translit?: string;
  pronunciation?: string;
  sense: string;
  lexiconRenderings: string[];
  source: string;
}

export interface WordStudyFamilyMember {
  strongs: string;
  word?: string;
  translit?: string;
  gloss: string;
  relationship: 'self' | 'parent' | 'child' | 'related';
  occurrences?: number;
}

export interface SemanticRangeData {
  /** Short honest label of where this came from, e.g. "Strong's and KJV usage". */
  sourceLabel: string;
  senses: Array<{ label: string; detail?: string; share?: number; source: string }>;
  domains?: Array<{ code: string; label: string; source: string }>;
}

/** Pluggable source of senses / domains; v1 ships the Strong's + usage source only. */
export interface ISemanticRangeSource {
  id: string;
  label: string;
  getSenses(input: {
    strongs: string;
    entry: WordStudyEntry | null;
    renderings: RenderingGroup[];
    module: string;
  }): SemanticRangeData | null;
}

export interface WordStudyOverview {
  subject: { kind: 'strongs' | 'group'; label: string; strongs?: string; language?: 'Greek' | 'Hebrew'; groupId?: string };
  entry: WordStudyEntry | null;
  /** Installed Bibles the study can run on (Strong's: tagged modules where it occurs). */
  modules: WordStudyModuleInfo[];
  /** The module the numbers below describe; undefined when nothing suitable is installed. */
  module?: string;
  moduleLanguage?: string;
  totals: { occurrences: number; verses: number };
  bookCounts: Record<number, number>;
  /** Strong's: how the translation renders the word. Group: each matched surface form. */
  forms: RenderingGroup[];
  morphology: Array<{ code: string; count: number }>;
  family: WordStudyFamilyMember[];
  semanticRange: SemanticRangeData | null;
  /** Group studies: whether a stemmer was applied for this module's language. */
  stemming?: boolean;
  /** Why the study is empty or limited, for the UI to show. */
  notice?: 'no-module' | 'not-tagged' | 'no-occurrences';
}

export interface WordOccurrenceQuery {
  module: string;
  book?: number;
  /** Filter to one entry of `forms` (its `key`). */
  form?: string;
  renderingMode?: RenderingMode;
  offset?: number;
  limit?: number;
}

export interface WordOccurrenceItem {
  verseId: number;
  /** 0-based inclusive word range within the verse text. */
  start: number;
  end: number;
  extra?: string;
  /** The rendering (Strong's) or matched form (group). */
  form: string;
  morph?: string;
  original?: string;
  /** Verse text in the module, for context display. */
  text?: string;
}

export interface WordOccurrencePage {
  total: number;
  items: WordOccurrenceItem[];
}

export interface IWordStudyProvider {
  resolve(query: string): Promise<WordKeyCandidate[]>;
  getOverview(subject: WordStudySubject, options?: WordStudyOptions): Promise<WordStudyOverview>;
  getOccurrences(subject: WordStudySubject, query: WordOccurrenceQuery): Promise<WordOccurrencePage>;
}
