/**
 * Module Format v2 - format constants, the version gate, and the content
 * registry.
 *
 * Pre-1.0 the version is NOT a compatibility range. Every 0.x minor is its
 * own format, and 1.0 is reserved for the first officially released, proven
 * format. So a reader carries the exact list of minors it can read, and
 * guesses nothing - {@link parseFormatVersion} / {@link isReadableFormatVersion}
 * are ALLOW-LISTS, never a numeric `<=` comparison. A newer-looking 0.x
 * (e.g. `'0.3'`) is refused exactly like a malformed string.
 */

import { ModuleType } from '../Core/Types';

/** The format version this build writes. */
export const FORMAT_VERSION = '0.2';

/**
 * Every `format_version` this build can still READ, besides {@link FORMAT_VERSION}
 * itself. Exact allow-list - not a range. Adding a new current version does
 * not make the previous one readable "for free"; it has to be listed here.
 */
export const READABLE_FORMAT_VERSIONS = ['0.1', '0.2'] as const;

/**
 * Legacy format strings from before the 0.x scheme (e.g. the `'2.0'` every
 * dev-catalog module carries today). Readable, but reported distinctly from
 * `'current'` / `'readable'` so callers can tell a pre-v2 module apart from
 * one that already speaks the new scheme. Retired (removed from this list)
 * once every such module has been reconverted.
 */
export const LEGACY_FORMAT_VERSIONS = ['2.0'] as const;

/**
 * How a module's `format_version` compares against what this build knows:
 *   - `current`:     exactly {@link FORMAT_VERSION}.
 *   - `readable`:    an older 0.x this build still knows how to read
 *                    ({@link READABLE_FORMAT_VERSIONS}).
 *   - `legacy`:      a pre-0.x string this build still knows how to read
 *                    ({@link LEGACY_FORMAT_VERSIONS}).
 *   - `unsupported`: anything else - a newer/unknown 0.x (e.g. `'0.3'`), any
 *                    major >= 1 other than a listed legacy string, or a
 *                    malformed string. Refuse; never guess.
 */
export type FormatVersionKind = 'current' | 'readable' | 'legacy' | 'unsupported';

/** Result of classifying a `format_version` string. See {@link FormatVersionKind}. */
export interface ParsedFormatVersion {
  /** The raw string that was classified, unchanged. */
  version: string;
  kind: FormatVersionKind;
}

/**
 * Classify a module's `format_version` against what this build can read.
 *
 * Pure allow-list lookup - never a numeric comparison. Never throws: a
 * malformed string (`''`, `'x'`, `'abc'`) simply comes back `'unsupported'`,
 * the same as an unrecognised well-formed one.
 */
export function parseFormatVersion(raw: string): ParsedFormatVersion {
  if (raw === FORMAT_VERSION) {
    return { version: raw, kind: 'current' };
  }
  if ((READABLE_FORMAT_VERSIONS as readonly string[]).includes(raw)) {
    return { version: raw, kind: 'readable' };
  }
  if ((LEGACY_FORMAT_VERSIONS as readonly string[]).includes(raw)) {
    return { version: raw, kind: 'legacy' };
  }
  return { version: raw, kind: 'unsupported' };
}

/**
 * True for any `format_version` this build can read at all - current,
 * readable, or legacy. False for anything unsupported (a newer/unknown 0.x
 * such as `'0.3'`, any unlisted major >= 1, or a malformed string).
 */
export function isReadableFormatVersion(raw: string): boolean {
  const { kind } = parseFormatVersion(raw);
  return kind === 'current' || kind === 'readable' || kind === 'legacy';
}

/**
 * Compression codecs a module's content may be stored under
 * (`module_info.compression`, tracked outside this file). Deliberately an
 * open string union, not an enum: a new codec is a additive change here, not
 * a call-site exhaustiveness break. Validated in TypeScript only - no
 * `isCompressionCodec` guard is needed for this subtask.
 */
export type CompressionCodec = 'none' | 'deflate' | 'zstd';

/**
 * The shape of one content table within a module type: which table/rowid it
 * is, which columns are prose (compressed when `module_info.compression !=
 * 'none'`) versus indexed (fed to `IIndexSource`; may be a superset or
 * subset of `prose`), and - where entries anchor to a verse range rather
 * than a single verse - the pair of range columns.
 */
export interface ContentShape {
  table: string;
  rowid: string;
  /** Compressed when `module_info.compression != 'none'`. */
  prose: readonly string[];
  /** Fed to `IIndexSource`; superset or subset of `prose`. */
  indexed: readonly string[];
  range?: { start: string; end: string };
}

/**
 * Content registry: for every {@link ModuleType}, the content table(s) it
 * carries and their shape. `cross_reference` and `tag_graph` carry no
 * `ContentShape` here - their tables (`cross_reference_group` /
 * `tag_association`, `entity_facet`, ...) are not prose/indexed content in
 * this sense.
 *
 * `lexicon` is not one of the eight module types the design doc enumerates
 * (§2.5-2.6 lists bible/commentary/dictionary/book/devotional/topical_index/
 * cross_reference/tag_graph only). It IS one of the 9 values of `ModuleType`
 * (`Data/Core/Types.ts`), documented there and in
 * `sql/schemas/initial/MainDatabase.sql` as "Legacy alias; new modules use
 * 'dictionary' with a dictionary_type of '*_lexicon'" - i.e. same table,
 * same columns as `dictionary`. `Record<ModuleType, ...>` requires every
 * `ModuleType` key, so it is mirrored on `dictionary`'s shape here. See the
 * final report for this call - it was not in the design doc's list and is
 * a judgement call, not a guess dressed up as fact.
 */
export const CONTENT_MAP: Record<ModuleType, readonly ContentShape[]> = {
  bible: [{ table: 'bible_verse', rowid: 'verse_id', prose: [],
            indexed: ['text'] }],
  commentary: [{ table: 'commentary_entry', rowid: 'entry_id', prose: ['content'],
                 indexed: ['content'], range: { start: 'verse_id_start', end: 'verse_id_end' } }],
  dictionary: [{ table: 'dictionary_entry', rowid: 'entry_id', prose: ['definition', 'usage_notes'],
                 indexed: ['word', 'definition', 'usage_notes'] }],
  // Legacy alias of 'dictionary' - see the doc comment on CONTENT_MAP above.
  lexicon: [{ table: 'dictionary_entry', rowid: 'entry_id', prose: ['definition', 'usage_notes'],
              indexed: ['word', 'definition', 'usage_notes'] }],
  book: [{ table: 'book_section', rowid: 'section_id', prose: ['content'],
           indexed: ['title', 'content'] }],
  devotional: [{ table: 'devotional_entry', rowid: 'entry_id', prose: ['content'],
                 indexed: ['title', 'content'] }],
  topical_index: [{ table: 'topic', rowid: 'topic_id', prose: [],
                    indexed: ['name', 'content'] }],
  cross_reference: [],
  tag_graph: [],
};
