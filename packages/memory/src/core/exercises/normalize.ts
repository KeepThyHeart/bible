/**
 * Word comparison. Every graded exercise routes through `wordsMatch`.
 *
 * This is the highest-stakes file in the extension and one of the smallest. A
 * user who types the right word and is told they are wrong does not conclude
 * "I should have typed the comma"; they conclude the app is broken, and they
 * stop trusting every score it has ever shown them. So the bias throughout is:
 * ignore anything the user could not reasonably have known to type, and keep
 * only the differences that are actually differences in the *word*.
 *
 * ## Why this cannot be "strip all punctuation and lowercase"
 *
 * `verse.words` is a plain whitespace split of the canonical verse text (see
 * `splitVerseWords` in @bible/core - the offset convention every word range in
 * the format is expressed in). Punctuation therefore arrives *attached* to
 * words: the KJV Psalm 1:1 tokens include `ungodly,` and `scornful.`. A naive
 * comparison marks a user who typed `ungodly` wrong. Equally, a comparison
 * that strips every apostrophe silently accepts `LORDs` for `LORD's`, which is
 * a genuinely different word and exactly the kind of detail memorisation is
 * meant to sharpen.
 *
 * ## What IS normalised away, and why
 *
 *   - **Case.** `LORD` vs `Lord` in most English Bibles is the small-caps
 *     rendering of the divine name versus the ordinary title - a *typographic*
 *     distinction that the stored text may or may not preserve and that a
 *     keyboard cannot express at all. Requiring the user to guess the casing
 *     of a word they recited correctly would punish them for the typesetter's
 *     choices.
 *   - **Leading and trailing punctuation.** Commas, full stops, semicolons,
 *     colons, question and exclamation marks, brackets, quotation marks and
 *     dashes sit *between* words, not inside them, and the panel renders them
 *     in the surrounding text where the user can already see them.
 *   - **Curly vs straight quotes, and the several Unicode dashes.** These are
 *     the same character as far as a person is concerned, and a keyboard
 *     produces only the ASCII ones. This fold is what lets a user type
 *     `LORD's` and match a module that stores the typographic apostrophe.
 *   - **Whitespace**, including the non-breaking and thin spaces that survive
 *     copy-paste, and the zero-width characters and soft hyphens that survive
 *     nothing but are invisible when they do.
 *
 * ## What is deliberately NOT normalised away
 *
 *   - **Internal apostrophes.** `LORD's` !== `LORDs`, and `thou'lt` !==
 *     `thoult`. The apostrophe carries the possessive or the elision; dropping
 *     it merges two different words and would mark a genuine recall failure
 *     correct. This is the one place we choose strictness over leniency,
 *     because the alternative makes the exercise measure less than it claims
 *     to. It costs nothing to implement: punctuation is only ever stripped at
 *     the *edges*, so the interior of a token is never touched.
 *   - **Internal hyphens.** `Beer-sheba` and `Baal-peor` are printed with the
 *     hyphen, and the blank the user fills is sized for the hyphenated token,
 *     so the hyphen is visible information rather than something to guess.
 *   - **Accents and any non-ASCII letter.** We fold punctuation, never
 *     letters. Stripping diacritics needs a table we cannot verify against
 *     every module a user might install, and getting it wrong corrupts
 *     comparisons silently in translations we never tested.
 *   - **Digits.** `1000` and `1,000` are left to differ if a translation ever
 *     produces them; inventing number equivalence here would be guessing.
 *
 * ## The one deliberate asymmetry
 *
 * A *trailing* apostrophe is stripped, so `sons'` matches `sons`. That is
 * leniency we accept knowingly: a trailing apostrophe is far more often a
 * closing single quote around reported speech (`he said, 'go'`) than a plural
 * possessive, and nothing in the token itself distinguishes the two. Marking a
 * correctly-typed word wrong because the verse happened to close a quotation
 * on it is the worse failure. The same reasoning covers a leading apostrophe,
 * which is either an opening quote or an elision (`'tis`); both ends are
 * stripped identically, so the comparison stays symmetric.
 */

/**
 * Characters that may be shaved off either end of a token.
 *
 * Note what is present: `'` and `-` are both here, and they are removed at the
 * edges only. That single fact is what implements the internal-apostrophe and
 * internal-hyphen rules above - there is no special case for them anywhere.
 */
export const EDGE_PUNCTUATION = ',.;:!?"\'()[]{}<>*/\\|_~+=&@#$%^`-«»‹›…¶§†‡';

/**
 * Punctuation folds, as [code point, replacement, name] rows.
 *
 * Written as code points rather than literal characters on purpose. Half of
 * this table is invisible or near-invisible in an editor - a soft hyphen, a
 * zero-width joiner and a narrow no-break space all look like nothing or like
 * a plain space - so a literal table is unreviewable and one bad copy-paste
 * silently changes behaviour. Numbers can be checked against a Unicode chart.
 *
 * No letter appears on either side of this table; see the note about accents
 * in the file header.
 */
const FOLD_TABLE: ReadonlyArray<readonly [number, string, string]> = [
  // Single quotes and primes -> ASCII apostrophe. This is the fold that makes
  // the meaningful internal apostrophe usable at all: without it, a module
  // storing the typographic form would reject every possessive ever typed.
  [0x2018, "'", 'left single quotation mark'],
  [0x2019, "'", 'right single quotation mark / typographic apostrophe'],
  [0x201a, "'", 'single low-9 quotation mark'],
  [0x201b, "'", 'single high-reversed-9 quotation mark'],
  [0x2032, "'", 'prime, occasionally used as an apostrophe'],
  // Double quotes.
  [0x201c, '"', 'left double quotation mark'],
  [0x201d, '"', 'right double quotation mark'],
  [0x201e, '"', 'double low-9 quotation mark'],
  [0x201f, '"', 'double high-reversed-9 quotation mark'],
  [0x2033, '"', 'double prime'],
  // Every dash-like character -> hyphen-minus. Em and en dashes stand between
  // words and are then stripped at the edges; a true hyphen inside a proper
  // name survives as the ASCII one and stays significant.
  [0x2010, '-', 'hyphen'],
  [0x2011, '-', 'non-breaking hyphen'],
  [0x2012, '-', 'figure dash'],
  [0x2013, '-', 'en dash'],
  [0x2014, '-', 'em dash'],
  [0x2015, '-', 'horizontal bar'],
  [0x2212, '-', 'minus sign'],
  // Spaces that are not U+0020.
  [0x00a0, ' ', 'no-break space'],
  [0x2007, ' ', 'figure space'],
  [0x2009, ' ', 'thin space'],
  [0x200a, ' ', 'hair space'],
  [0x202f, ' ', 'narrow no-break space'],
  [0x3000, ' ', 'ideographic space'],
  // Invisible characters, removed entirely. The soft hyphen is the nastiest of
  // these: it renders as nothing at all, so the user types exactly the word
  // they see and is marked wrong by a character they cannot perceive.
  [0x00ad, '', 'soft hyphen'],
  [0x200b, '', 'zero-width space'],
  [0x200c, '', 'zero-width non-joiner'],
  [0x200d, '', 'zero-width joiner'],
  [0xfeff, '', 'byte-order mark / zero-width no-break space'],
];

/** The fold table indexed by character, built once at module load. */
const CHAR_FOLDS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const row of FOLD_TABLE) {
    map[String.fromCharCode(row[0])] = row[1];
  }
  return map;
})();

/** Highest code point treated as a control character. */
const LAST_CONTROL = 0x1f;
/** DEL, the one control character above the C0 block worth handling. */
const DEL = 0x7f;

/**
 * Apply the punctuation folds and collapse whitespace, preserving case.
 *
 * Kept separate from `normalizeWord` because `firstLetters.ts` needs the
 * folded, edge-stripped form *with* its original capitalisation: the initial
 * it shows the user is the letter as the text prints it.
 */
function fold(word: string): string {
  if (typeof word !== 'string') return '';
  let out = '';
  for (const ch of word) {
    const mapped = CHAR_FOLDS[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code <= LAST_CONTROL || code === DEL) {
      // Tabs, newlines and other controls behave as whitespace.
      out += ' ';
    } else {
      out += ch;
    }
  }
  // Collapse runs of spaces and trim. A single token should not contain any
  // whitespace, but a user pasting into a blank input routinely produces
  // `" the "`, and that is not a mistake worth failing them for.
  return out.replace(/ {2,}/g, ' ').trim();
}

/**
 * Fold, then remove punctuation from both ends. Case is preserved.
 *
 * Returns `''` for a token that is nothing but punctuation. The caller decides
 * what that means - `blanks.ts` refuses to blank such a token, because there
 * would be nothing for the user to type into the gap.
 */
export function stripEdgePunctuation(word: string): string {
  const folded = fold(word);
  let start = 0;
  let end = folded.length;
  while (start < end && EDGE_PUNCTUATION.indexOf(folded.charAt(start)) !== -1) start += 1;
  while (end > start && EDGE_PUNCTUATION.indexOf(folded.charAt(end - 1)) !== -1) end -= 1;
  return folded.slice(start, end);
}

/**
 * The canonical comparison form of a word.
 *
 * Deliberately a pure string -> string function rather than a bespoke
 * comparison routine: it can be logged, diffed and asserted on, which is the
 * difference between a mismatch report you can debug and one you can only
 * argue with.
 */
export function normalizeWord(word: string): string {
  return stripEdgePunctuation(word).toLowerCase();
}

/**
 * Does `typed` count as `target`?
 *
 * The argument order is (typed, target). The implementation happens to be
 * symmetric, but the intent is not: `target` always comes from verse text and
 * `typed` always comes from a human, and future leniency rules (if any) belong
 * on the typed side only.
 */
export function wordsMatch(typed: string, target: string): boolean {
  const t = normalizeWord(typed);
  const g = normalizeWord(target);

  if (g === '') {
    // The target token carried no word content at all - a stray `--` or a lone
    // pilcrow left in a module's text. Nothing sensible can be typed for it,
    // so fall back to comparing the folded forms and let an exact echo pass.
    // We do NOT return `true` unconditionally: accepting anything here would
    // hide a module tokenisation bug behind a perfect score.
    return fold(typed).toLowerCase() === fold(target).toLowerCase();
  }

  // An empty answer is never correct for a real word. This is also the path
  // that catches a blank the user skipped, which the panel sends as `''`.
  if (t === '') return false;

  return t === g;
}
