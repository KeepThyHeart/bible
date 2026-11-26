import type { ReferenceEngine } from './engine';
import type { RefBook, ReferenceParseFailure, ReferenceRange } from './types';

/** One passage of a parsed list. Offsets index the original input. */
export interface ReferenceListItem {
  range: ReferenceRange;
  text: string;
  start: number;
  end: number;
}

export interface ReferenceListError {
  text: string;
  start: number;
  end: number;
  reason: ReferenceParseFailure | 'too-many';
  book?: RefBook;
}

export interface ReferenceListResult {
  ok: boolean;
  items: ReferenceListItem[];
  errors: ReferenceListError[];
}

export interface ReferenceListOptions {
  /** Accept a bare book name as the whole book. Default true. */
  allowWholeBook?: boolean;
  /** Reject chapters beyond the book's last chapter. Default true. */
  checkChapters?: boolean;
  /** Typo correction for book names. Default false. */
  fuzzy?: boolean;
  /** Most items accepted. Default 50. */
  maxItems?: number;
}

/**
 * Parses a list of references that may span several books
 * ("Ps 23; Rom 8:28-39; Gen 1-2"). A thin wrapper: the logic lives in
 * {@link ReferenceEngine.parseList}, so book starts are detected exactly as
 * the engine does (any Unicode digits, every locale's names).
 */
export function parseReferenceList(
  engine: ReferenceEngine,
  input: string,
  opts: ReferenceListOptions = {},
): ReferenceListResult {
  return engine.parseList(input, opts);
}
