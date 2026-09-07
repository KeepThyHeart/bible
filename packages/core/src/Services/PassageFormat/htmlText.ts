/**
 * Tag stripping and entity handling for verse text, without a DOM.
 *
 * This used to be `document.createElement('div'); div.innerHTML = html;` and
 * then a read of `textContent` (to get plain text) or of `innerHTML` (to get
 * markup back, normalised by the parser). That works in a renderer and nowhere
 * else - core is imported by Node scripts and its tests run under `node`, so
 * the format engine could not come with it. These three functions are the
 * replacement, written as string transforms.
 *
 * ## What the parser did that this reproduces
 *
 * - **Tags are removed, their content kept.** `<b>bold</b> text` -> `bold text`.
 * - **Entities are decoded** on the way to plain text, so `&amp;` reads as
 *   `&` and `&nbsp;` as a space (it collapses with its neighbours, exactly as
 *   a parsed U+00A0 did, because `\s` matches it).
 * - **A stray `&` or `<` is escaped** on the way to *markup*. The parser
 *   decoded the input and re-serialised it, which turned a bare `&` into
 *   `&amp;` and a `<` that began no tag into `&lt;`; {@link escapeStrayMarkup}
 *   keeps that, so the HTML flavour of a verse stays well-formed rather than
 *   depending on a browser's error recovery.
 *
 * ## What it deliberately does not reproduce
 *
 * - **Tag balancing.** The parser closed an unclosed `<span>`; a string
 *   transform cannot. Verse markup is produced by `VerseFormatter` in this
 *   same package and is always balanced, so this never arises in practice -
 *   but a hand-crafted, truncated input now passes through as written instead
 *   of being repaired.
 * - **Re-encoding a named entity to its character.** `&frac12;` survives as
 *   `&frac12;` in the markup flavour rather than becoming `½`. It renders
 *   identically; only the intermediate string differs.
 * - **Escaping a bare `>`.** The serialiser wrote `&gt;`; this leaves it. A
 *   `>` outside a tag is valid character data in HTML, so it renders the same.
 * - **Lower-casing tag and attribute names.** `<transChange>` stays as
 *   written rather than becoming `<transchange>`. HTML is case-insensitive
 *   here, and nothing downstream matches on case.
 *
 * Neither shows up in real module text: a scan of every `bible_*.db` in the
 * repo's module set finds no HTML entity in any verse, and the only literal
 * tags are two stray artefacts in one module. The markup these functions
 * actually see is what `VerseFormatter.formatVerseText()` writes -
 * `<span class="christ-words">`, `<span class="divine-name">`, and the legacy
 * `<font color="red">` from older conversions.
 */

/**
 * Matches a start tag, an end tag, a comment, or a doctype/CDATA-ish `<!...>`.
 *
 * Not `/<[^>]*>/`: HTML only begins a tag at `<` followed by a letter, `/` or
 * `!`, so `"a < b > c"` is three words to a parser and would have been
 * mangled into `"a c"` by the looser pattern. Scripture contains `<` far more
 * often than it contains markup (it does not contain markup at all in most
 * modules), so the distinction is worth the extra alternation.
 */
const HTML_TAG_PATTERN = /<!--[\s\S]*?-->|<[!/]?[a-zA-Z][^>]*>|<!\[[^\]]*\]>/g;

/** The named entities that appear in Bible module text, plus the XML five. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  para: '¶',
  middot: '·',
  deg: '°',
  frac12: '½',
  eacute: 'é',
};

const ENTITY_PATTERN = /&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g;

/**
 * Decode the HTML entities a verse can carry.
 *
 * Numeric entities are decoded in full (decimal and hex); named ones are
 * decoded from the table above. An unrecognised named entity is left exactly
 * as written - dropping it would silently delete text, and `&`-followed-by-a-
 * word is far more likely to be prose ("Q&A;") than an entity this table has
 * never heard of.
 *
 * Surrogate and out-of-range code points are left alone rather than throwing:
 * a malformed module must not be able to crash a copy.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY_PATTERN, (whole, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      // Lone surrogates are not characters; keeping the source text is safer
      // than emitting an unpaired code unit into the clipboard.
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? whole : named;
  });
}

/**
 * Remove every tag, keeping the text between them.
 *
 * Entities are **not** decoded here - this is the raw counterpart used where
 * the caller already holds a markup string and only wants the characters out
 * of it (`passageMarkup`'s text flavour), matching what the old code got from
 * reading `innerHTML` and stripping tags off it by hand.
 */
export function stripHtmlTags(html: string): string {
  return html.replace(HTML_TAG_PATTERN, '');
}

/**
 * Escape the characters in a markup string that are not doing a markup job:
 * an `&` that starts no entity, a `<` that starts no tag.
 *
 * The DOM round-trip did this implicitly - parse decoded the text, serialise
 * re-encoded it - so a verse containing "Q&A" came back as "Q&amp;A".
 * Reproduced here so the markup flavour of a verse is valid HTML whatever the
 * module contains, rather than leaning on a browser's error recovery.
 *
 * A `<` is left alone when the next character is one that can begin a tag,
 * an end tag, a comment or a declaration (`a-z`, `/`, `!`, `?`) - exactly the
 * cases an HTML tokenizer treats as markup. Everything else ("2 < 3") is
 * character data, and the parser escaped it too.
 */
export function escapeStrayMarkup(html: string): string {
  let out = html;
  if (out.includes('&')) {
    out = out.replace(/&(?!(?:#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);)/g, '&amp;');
  }
  if (out.includes('<')) {
    out = out.replace(/<(?![a-zA-Z!?/])/g, '&lt;');
  }
  return out;
}

/** Escape text that is about to be placed into markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
