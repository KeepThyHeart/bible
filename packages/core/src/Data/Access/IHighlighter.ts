/**
 * The highlighting contract (task 0027, "Module Format v2", revision 2,
 * subtask F7, design doc §4.5 - task 0026's M8). See `Fts5/Fts5Highlighter.ts`
 * for the one implementation this pass adds.
 *
 * ## Why offsets, not marked-up HTML
 *
 * `spans()` returns `Match[]` (`types/search.ts`): character-offset spans
 * into the CALLER's own copy of `text`, never a string with tags injected.
 * The app stores clean text with its own formatting spans (italics, added
 * words, Strong's numbers, ...) separately, and a highlighter that returned
 * `<strong><u>...</u></strong>`-laced HTML would collide with them the
 * moment both needed to apply to overlapping ranges. Turning `Match[]` back
 * into markup (if a caller wants that) is the caller's job, done against its
 * own copy of `text` - never this interface's.
 *
 * ## Why `KeywordQuery`, not a term list
 *
 * An earlier sketch split this into `terms(q, tokenizer)` + `spans(text,
 * terms)`. Task 0027's review rejected it: extracting a term list from a
 * `KeywordQuery` first is exactly the step that would need a hand-rolled
 * Porter stemmer to get right (so "walk" still finds "walking"/"walked"
 * highlighted), which is the one piece of FTS5 machinery nothing in this
 * package wants to reimplement. Taking the whole `KeywordQuery` instead lets
 * an implementation hand the query straight back to the SAME query language
 * (and, for `Fts5Highlighter`, the SAME tokenizer) that already answered it -
 * see that class's doc comment for the mechanism.
 */

import { Match } from '../../types/search';
import { KeywordQuery } from './KeywordTypes';

export interface IHighlighter {
  /**
   * Find every match `q` would highlight inside `text`, as offset spans.
   *
   * - No match ⇒ `[]`, never a throw - `text` genuinely not matching `q` is
   *   an ordinary outcome (a caller may highlight text it merely suspects
   *   matches), not a caller error.
   * - Offsets are into `text` exactly as passed in: `text.slice(m.startPos,
   *   m.endPos)` is the matched substring, for every returned `Match`.
   */
  spans(text: string, q: KeywordQuery): Match[];
}
