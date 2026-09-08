/**
 * Miscellaneous default inputs keyed by `HookInputShape`.
 *
 * Covers the shapes that are smaller / less structured than the verse,
 * reference, storage, and network corpora: dictionary keys, book section
 * ids, command arguments, and event payloads. `none` is present for
 * completeness so callers can iterate every shape without a special case.
 */

export const DEFAULT_DICTIONARY_KEY_CORPUS: readonly string[] = Object.freeze([
  // Strong's — Greek.
  'G25',       // agapao
  'G26',       // agape
  'G3056',     // logos
  'G2424',     // Iesous
  'G5485',     // charis
  // Strong's — Hebrew.
  'H430',      // Elohim
  'H3068',     // YHWH
  'H2617',     // chesed
  'H1288',     // barak
  'H7225',     // reshith
  // Lemma / headword style.
  'Love',
  'Faith',
  'grace',
  'Messiah',
  'Logos',
  // Mixed-case / punctuation.
  'Son of Man',
  "Jehovah-jireh",
  'I AM',
  // Non-ASCII.
  '\u03b1\u03b3\u03ac\u03c0\u03b7', // agapē
  '\u05d0\u05b1\u05dc\u05b9\u05d4\u05b4\u05d9\u05dd', // Elohim
  // Malformed — hook must not crash.
  '',
  ' ',
  'G',
  'G-1',
  'G0',
  'H999999',
  'NOT_A_KEY',
  '???',
]);

export const DEFAULT_SECTION_ID_CORPUS: readonly string[] = Object.freeze([
  'root',
  'chapter-1',
  'chapter-12',
  'preface',
  'introduction',
  'appendix-a',
  'part-2/chapter-3',
  'nested/deeply/in/a/book/section-17',
  '0',
  '1',
  // Malformed.
  '',
  ' ',
  '..',
  '/',
  '../../etc/passwd',
  'section with spaces',
  '\u4e2d\u6587-section',
]);

export const DEFAULT_COMMAND_ARGS_CORPUS: readonly unknown[] = Object.freeze([
  undefined,
  null,
  [],
  [{}],
  [{ verseId: 43003016 }],
  [{ verseId: 43003016, module: 'kjv' }],
  [{ range: { startVerseId: 43003016, endVerseId: 43003018 } }],
  [{ text: 'John 3:16' }],
  [{ text: '' }],
  ['string-arg'],
  [42],
  [true],
  [{ deeply: { nested: { value: 'x'.repeat(1024) } } }],
]);

export const DEFAULT_EVENT_PAYLOAD_CORPUS: readonly unknown[] = Object.freeze([
  undefined,
  null,
  {},
  { verseId: 43003016 },
  { verseId: 43003016, module: 'kjv' },
  { verseId: 1001001 },
  { verseId: 66022021 },
  { range: { startVerseId: 43003016, endVerseId: 43003018 } },
  { reference: 'John 3:16' },
  // Malformed payloads — events may arrive from other extensions or the host.
  { verseId: -1 },
  { verseId: 'not a number' },
  'unexpected-string',
  42,
]);

/** Single-entry corpus for hooks that take no input (panels, statusBar items, etc.). */
export const DEFAULT_NONE_CORPUS: readonly unknown[] = Object.freeze([undefined]);
