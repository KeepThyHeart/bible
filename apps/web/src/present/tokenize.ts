/**
 * Splitting verse HTML into indexed words.
 *
 * This is the piece that lets a highlight travel as two numbers. The controller
 * says "words 4 through 9 of verse 43003016" and every screen showing that verse
 * paints the same words -- but only because every screen tokenizes the text the
 * same way. Both ends of the presenter import *this* module, so they agree by
 * construction rather than by both being careful.
 *
 * The indexing convention is the project-wide one: **0-based, inclusive**, the
 * same as `textStart`/`textEnd` on core's `UserTextMarkup` and the same as the
 * desktop app's `data-word-index`. The algorithm below deliberately mirrors
 * `apps/desktop/src/ui/utils/wordIndexing.ts` -- same punctuation rule, same
 * whitespace handling -- so that when tokenization eventually moves into
 * `packages/core` this is a move rather than a rewrite, and highlights saved on
 * the desktop can be presented without renumbering.
 *
 * It is written without `DOMParser` on purpose. The desktop version parses a
 * document per verse, which is fine for one verse under a cursor and wasteful
 * for a whole chapter on every state change; more importantly, a DOM-free
 * version can also run on the server if phrase matching ever needs to.
 */

/** One word, with everything needed to render it exactly as the source did. */
export interface WordToken {
  /**
   * The word with surrounding punctuation stripped. This is what matching and
   * indexing use, so that "loved," and "loved" are the same word.
   */
  text: string;
  /** The word as it appears, punctuation included. This is what is rendered. */
  displayText: string;
  /** Inside `<span class="christ-words">` -- the red-letter treatment. */
  isChristWords: boolean;
  /** Inside `<span class="divine-name">` -- small caps for the Tetragrammaton. */
  isDivineName: boolean;
  /** Inside `<i>` or `<em>` -- words supplied by the translators. */
  isItalic: boolean;
  /** Whether a space followed, so the words can be reassembled faithfully. */
  hasTrailingSpace: boolean;
}

/**
 * Named entities `formatVerseText` and the module sources actually emit.
 *
 * A full entity table would be dead weight: this content is Scripture that has
 * already been through core's formatter, not arbitrary web HTML. Numeric
 * references are handled generically below, which covers everything else.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // Anything outside the Unicode range, or a parse failure, is left as
      // written: showing "&#xZZ;" is better than showing a replacement glyph.
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Leading punctuation, the word itself, trailing punctuation.
 *
 * Apostrophes stay inside the word so contractions and possessives ("can't",
 * "Lord's") index as one word rather than two.
 */
const PUNCTUATION_SPLIT = /^([^\w']*)([\w']+)([^\w']*)$/;

interface Formatting {
  isChristWords: boolean;
  isDivineName: boolean;
  isItalic: boolean;
}

/** Which formatting flag, if any, a tag turns on. */
function flagForTag(tagName: string, attributes: string): keyof Formatting | null {
  if (tagName === 'i' || tagName === 'em') return 'isItalic';
  if (tagName !== 'span') return null;
  if (/class\s*=\s*["'][^"']*\bchrist-words\b/.test(attributes)) return 'isChristWords';
  if (/class\s*=\s*["'][^"']*\bdivine-name\b/.test(attributes)) return 'isDivineName';
  return null;
}

/**
 * Tokenize one verse's formatted HTML.
 *
 * Returns an empty array for empty input, which the caller can treat as "no
 * words to highlight" rather than as an error.
 */
export function tokenizeVerse(verseHtml: string): WordToken[] {
  const tokens: WordToken[] = [];
  if (!verseHtml) return tokens;

  // A stack rather than a flag per format: `christ-words` wrapping
  // `divine-name` is the normal nesting core emits, and a closing tag has to
  // undo exactly what its opener did -- including the openers that carry no
  // formatting at all, which is why unrecognised tags push `null`.
  const stack: Array<keyof Formatting | null> = [];

  let cursor = 0;
  while (cursor < verseHtml.length) {
    const tagStart = verseHtml.indexOf('<', cursor);

    if (tagStart === -1) {
      appendText(tokens, decodeEntities(verseHtml.slice(cursor)), snapshot());
      break;
    }

    if (tagStart > cursor) {
      appendText(tokens, decodeEntities(verseHtml.slice(cursor, tagStart)), snapshot());
    }

    const tagEnd = verseHtml.indexOf('>', tagStart);
    if (tagEnd === -1) {
      // An unterminated tag. Treat the remainder as markup and stop, rather
      // than emitting half a tag as words on a wall.
      break;
    }

    const raw = verseHtml.slice(tagStart + 1, tagEnd);
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const closing = body.startsWith('/');
    const name = (closing ? body.slice(1) : body).match(/^[a-zA-Z0-9]+/)?.[0]?.toLowerCase() ?? '';

    if (closing) {
      stack.pop();
    } else if (!selfClosing && name && !VOID_TAGS.has(name)) {
      stack.push(flagForTag(name, body.slice(name.length)));
    }

    cursor = tagEnd + 1;
  }

  return tokens;

  function snapshot(): Formatting {
    return {
      isChristWords: stack.includes('isChristWords'),
      isDivineName: stack.includes('isDivineName'),
      isItalic: stack.includes('isItalic'),
    };
  }
}

/** Tags that never have a closing partner, so they must not push onto the stack. */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'wbr']);

function appendText(tokens: WordToken[], text: string, formatting: Formatting): void {
  if (!text) return;

  // Whitespace at the start of this run belongs to the previous word. Without
  // this, text split across a tag boundary ("God</span> so") loses the space
  // and reassembles as "Godso".
  if (/^\s/.test(text) && tokens.length > 0) {
    tokens[tokens.length - 1].hasTrailingSpace = true;
  }

  const pattern = /(\S+)(\s*)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const rawWord = match[1];
    const trailingSpace = match[2];
    if (!rawWord) continue;

    const split = PUNCTUATION_SPLIT.exec(rawWord);
    // No word characters at all (a lone dash or bracket) still has to be
    // rendered, so it becomes a token whose clean text is the mark itself.
    const clean = split?.[2] ?? rawWord;
    if (!clean) continue;

    tokens.push({
      text: clean,
      displayText: rawWord,
      isChristWords: formatting.isChristWords,
      isDivineName: formatting.isDivineName,
      isItalic: formatting.isItalic,
      hasTrailingSpace: trailingSpace.length > 0,
    });
  }
}

/** Just the indexable words, for matching. */
export function verseWords(verseHtml: string): string[] {
  return tokenizeVerse(verseHtml).map(token => token.text);
}
