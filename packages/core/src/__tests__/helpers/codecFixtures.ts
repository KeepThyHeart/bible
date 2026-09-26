/**
 * Shared test material for the content codecs (task 0027 F4).
 *
 * No compressed module file exists anywhere yet - every real module in
 * `data/modules/` is `compression = 'none'` or predates the column - so every
 * compressed fixture in the suite is generated here, at test time, by the very
 * codecs under test. That is deliberate: a checked-in binary blob would prove
 * only that the codec still agrees with whatever produced the blob, whereas a
 * round trip through a real SQLite BLOB column proves the whole path.
 */

/**
 * The strings every codec is round-tripped against.
 *
 * Chosen for the ways a byte-level codec can go wrong, not for variety:
 * multi-byte UTF-8 that a naive `latin1`/`binary` conversion would mangle, an
 * empty input (a legal zero-length frame, and the input most likely to be
 * special-cased into a bug), text that *looks* like frame headers, and real
 * commentary prose at a realistic length.
 */
export const CODEC_CORPUS = {
  /** Plain ASCII, short. */
  ascii: 'Verse 4. No specific Barnes text on this verse.',

  /**
   * Real commentary prose, verbatim in shape from `commentary_barnes.db`
   * (HTML anchors and all - shipped commentary content is HTML, which is why
   * `rowToIndexDocument` strips it). Reproduced rather than read from the
   * file: `data/modules/` is gitignored and absent on a clean checkout.
   */
  prose:
    'Verse 4. No specific Barnes text on this verse. ' +
    '<a href="passagestudy.jsp?action=showRef&type=scripRef&value=Mt+1%3A3&module=">Mt 1:3</a>. ' +
    '<br /><br /> (k) "begat Naason" ' +
    '<a href="passagestudy.jsp?action=showRef&type=scripRef&value=1Chr+2%3A10%2C+Nu+1%3A7&module=">1Chr 2:10, Nu 1:7</a> ' +
    '(l) "begat Salmon" ' +
    '<a href="passagestudy.jsp?action=showRef&type=scripRef&value=Ruth+4%3A20&module=">Ruth 4:20</a>',

  /**
   * Non-ASCII across several scripts a real module carries: Greek and Hebrew
   * (original-language modules), accented Latin (translators' names, French
   * and Scandinavian titles), an em dash and a CJK pair for good measure.
   */
  utf8: 'Ἐν ἀρχῇ ἦν ὁ Λόγος — בְּרֵאשִׁית בָּרָא אֱלֹהִים — Café, naïve, Ærø, Zürich, 你好',

  /** Zero length. A legal frame in both codecs, and the likeliest off-by-one. */
  empty: '',

  /**
   * Text that renders as the codecs' own frame headers: zstd's magic
   * `28 b5 2f fd` as characters, and zlib's `78 9c` CMF/FLG. Nothing in this
   * format sniffs a cell's bytes to decide what it is (the codec comes from
   * `module_info`, never from the cell), and this fixture is here so that
   * stays true - a codec that started guessing would trip over it.
   */
  magicLike: '(µ/ý\u0000\u0000x\u009c\u001f\u008b\u0008 not actually a frame',

  /** Long and highly compressible - the case a preset dictionary is bought for. */
  repetitive: 'In the beginning God created the heaven and the earth. '.repeat(40),
} as const;

/** Every corpus entry, as `[name, text]`, for `it.each`. */
export const CODEC_CORPUS_CASES: ReadonlyArray<readonly [string, string]> = Object.entries(
  CODEC_CORPUS
);

/**
 * Stand-in for a trained compression dictionary: representative commentary
 * text, the kind of thing a real trainer would be fed.
 *
 * Both codecs accept arbitrary bytes as a preset dictionary - raw DEFLATE's
 * window preload (RFC 1951) and zstd's "raw content dictionary" - so this is
 * a genuine, working dictionary for both, not a mock. It is not a *trained*
 * one (`zstd --train` emits a dictionary with its own magic and a non-zero
 * dictID), which matters in exactly one place, called out where it is tested:
 * a raw content dictionary leaves the zstd frame's dictID at 0.
 */
export const TEST_DICTIONARY: Uint8Array = new TextEncoder().encode(
  'Verse 1. In the beginning God created the heaven and the earth. ' +
    '<a href="passagestudy.jsp?action=showRef&type=scripRef&value=' +
    'Barnes on the New Testament. See the notes at ' +
    'begat Naason begat Salmon begat Boaz of Rachab ' +
    'This is the same as that which is rendered in the margin, and is ' +
    'The word here used denotes properly the act of the Spirit of God upon the heart. '
);

/** A different dictionary, for "the wrong dictionary" tests. */
export const OTHER_DICTIONARY: Uint8Array = new TextEncoder().encode(
  'Strong’s Hebrew lexicon entry: a primitive root; to split, divide, cleave, ' +
    'compare the Aramaic cognate; figuratively, to reason out, to discern. '
);
