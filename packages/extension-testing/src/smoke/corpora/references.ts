/**
 * Default reference-string corpus for smoke testing.
 *
 * Targets hooks that parse human-entered reference text. Includes canonical,
 * abbreviated, malformed, and Unicode-localized forms.
 */

export const DEFAULT_REFERENCE_STRING_CORPUS: readonly string[] = Object.freeze([
  // Canonical.
  'John 3:16',
  'Genesis 1:1',
  'Psalm 23:1',
  'Romans 8:28',
  'Revelation 22:21',

  // Ranges.
  '1 Corinthians 13:4-7',
  'Romans 8:28-30',
  'Psalm 23:1-6',
  'John 3:16-18',

  // Cross-chapter ranges.
  'Genesis 1:31-2:1',
  'Romans 8:38-9:1',

  // Full-chapter forms.
  'Psalm 117',
  'Psalm 119',
  'John 3',

  // Whole-book single-chapter refs.
  'Obadiah 1',
  'Philemon 1',
  'Jude',
  '3 John',

  // Abbreviations (common, varied punctuation).
  'Jn 3:16',
  'Jn. 3:16',
  'Jno. 3:16',
  'Joh 3:16',
  '1 Cor 13:4-7',
  '1Co 13:4',
  'I Cor. 13:4',
  'Rom 8:28',
  'Ro 8:28',
  'Ps 23',
  'Psa 23:1',
  'Gen. 1:1',
  'Ge 1:1',
  'Rev 22:21',
  'Re 22:21',
  'Phlm 1:25',
  'Obad 1:1',
  '2 Jn 13',
  '3 Jn 14',

  // Non-standard separators / spacing.
  'John 3.16',
  'John  3:16',
  'John3:16',
  'john 3:16',
  'JOHN 3:16',
  'Rom viii 28',

  // Malformed — harness should still invoke; extension is expected to reject gracefully.
  '',
  '   ',
  'John',
  'John 3',
  '3:16',
  ':16',
  'John :16',
  'John 3:',
  'John 3::16',
  'John -3:16',
  'John 3:-16',
  'John 0:0',
  'John 999:999',
  'Xyzzy 1:1',
  'Gospel of Thomas 1:1',
  '42',
  '#@!',
  'John 3:16; Romans 8:28',
  'John 3:16\nGen 1:1',

  // Unicode / localized book names.
  'Juan 3:16',
  'Génesis 1:1',
  '\u4e3e\u7ffc 3:16',       // Chinese (approx.)
  '\u092f\u0942\u0939\u0928\u094d\u0928\u093e 3:16', // Hindi (Yohana)
  '\u03ba\u03b1\u03c4\u03ac \u0399\u03c9\u03ac\u03bd\u03bd\u03b7\u03bd 3:16', // Greek
  '\u064a\u0648\u062d\u0646\u0627 3:16', // Arabic
  '\u05d1\u05e8\u05d0\u05e9\u05d9\u05ea 1:1', // Hebrew (Bereshit)

  // Zero-width / control characters.
  'John\u200b 3:16',
  'John\u00a03:16',
]);
