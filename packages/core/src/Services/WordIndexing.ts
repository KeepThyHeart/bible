/**
 * Tokenising verse display HTML into indexed words, without a DOM.
 *
 * The token sequence produced here is the index space that
 * `interlinear_word.word_position_start` / `word_position_end`, highlight and
 * underline markup (`user_text_markup.text_start` / `text_end`) and the
 * `formatting.spans` ranges all address, so it has to be derived from the same
 * `text_html` the reader sees - see `InterlinearCells.ts` for why that matters.
 * Both apps used to keep their own copy of this module; a one-token
 * disagreement between them would silently misalign interlinear rows against
 * English words in one app and not the other.
 *
 * ## Why not `DOMParser`
 *
 * Both copies parsed `<div>${html}</div>` with `DOMParser` and walked the
 * nodes. Core is imported by Node scripts and its tests run without a DOM, so
 * this walks the markup as a string instead. The markup it sees is what
 * `formatVerseFields()` writes - `<span class="christ-words">`,
 * `<span class="divine-name">` - which is well-formed and balanced, so the
 * string walk agrees with the parser on it. What it does not reproduce is
 * HTML's error recovery for malformed input (implied end tags, misnested
 * formatting elements): an end tag closes the nearest open element of the same
 * name, and a stray one is ignored. Entities are decoded with the same table
 * `decodeHtmlEntities` uses.
 *
 * The DOM-walking helpers the desktop app keeps beside this (find the word
 * element under the mouse, read `data-word-index`) need real `Element`s and
 * stay in the desktop app.
 */

import { decodeHtmlEntities } from './PassageFormat/htmlText';

/** One whitespace-separated word of a verse, with the formatting it inherited. */
export interface WordInfo {
  /** Word with surrounding punctuation stripped - the matching/indexing form. */
  text: string;
  /** Word exactly as it appears, punctuation included - the rendering form. */
  displayText: string;
  isChristWords: boolean;
  /**
   * Word sits inside a `<span class="divine-name">` - the small-caps treatment
   * `formatVerseFields()` applies to the Tetragrammaton. Tracked alongside
   * `isChristWords` because flattening the HTML to tokens otherwise loses it,
   * and the interlinear renderer builds its output from these tokens rather
   * than re-emitting the source HTML.
   */
  isDivineName: boolean;
  hasTrailingSpace: boolean;
}

/**
 * A comment, a doctype/CDATA-ish declaration, or a start/end tag. Quoted
 * attribute values may contain `>`. A `<` that begins none of these is text,
 * exactly as an HTML tokenizer treats it.
 */
const MARKUP_PATTERN =
  /<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>|<\/?[a-zA-Z][^\s/>]*(?:"[^"]*"|'[^']*'|[^>"'])*>/g;

const TAG_NAME_PATTERN = /^<(\/?)([a-zA-Z][^\s/>]*)/;
const CLASS_ATTRIBUTE_PATTERN = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/** Elements that never have content or an end tag. */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

interface OpenElement {
  name: string;
  isChrist: boolean;
  isDivine: boolean;
}

function classesOf(tag: string): string[] {
  const match = CLASS_ATTRIBUTE_PATTERN.exec(tag);
  if (!match) return [];
  return (match[1] ?? match[2] ?? match[3] ?? '').split(/\s+/).filter(Boolean);
}

/**
 * Split verse HTML into words, carrying each word's formatting flags along.
 *
 * @param verseHTML Verse display HTML (`verse.text_html`)
 * @returns One {@link WordInfo} per whitespace-separated token
 *
 * @example
 * extractWordsWithFormatting('<span class="christ-words">I am</span> he')
 * // -> [{ text: 'I', isChristWords: true, ... }, { text: 'am', ... }, { text: 'he', isChristWords: false, ... }]
 */
export function extractWordsWithFormatting(verseHTML: string): WordInfo[] {
  const words: WordInfo[] = [];
  const open: OpenElement[] = [];

  const addText = (raw: string): void => {
    const text = decodeHtmlEntities(raw);
    if (text.length === 0) return;

    // Leading whitespace belongs to the previous word: element boundaries
    // split a single space across two text nodes.
    if (/^\s/.test(text) && words.length > 0) {
      words[words.length - 1].hasTrailingSpace = true;
    }

    const current = open[open.length - 1];
    const isChristWords = current?.isChrist ?? false;
    const isDivineName = current?.isDivine ?? false;

    const pattern = /(\S+)(\s*)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const rawWord = match[1];
      const hasTrailingSpace = match[2].length > 0;

      // Strip leading/trailing punctuation for the indexing form, keeping
      // apostrophes inside words so contractions ("can't") stay one token.
      // A token with no word characters (pure punctuation) is still a token,
      // so indices stay aligned with the importer's whitespace split.
      const wordMatch = rawWord.match(/^([^\w']*)([\w']+)([^\w']*)$/);
      words.push({
        text: wordMatch && wordMatch[2].length > 0 ? wordMatch[2] : rawWord,
        displayText: rawWord,
        isChristWords,
        isDivineName,
        hasTrailingSpace,
      });
    }
  };

  let last = 0;
  MARKUP_PATTERN.lastIndex = 0;
  let markup: RegExpExecArray | null;
  while ((markup = MARKUP_PATTERN.exec(verseHTML)) !== null) {
    addText(verseHTML.slice(last, markup.index));
    last = markup.index + markup[0].length;

    const tag = TAG_NAME_PATTERN.exec(markup[0]);
    if (!tag) continue; // comment / declaration: only a text-node boundary

    const name = tag[2].toLowerCase();
    if (tag[1] === '/') {
      // End tag: close the nearest open element of that name; ignore a stray one.
      for (let i = open.length - 1; i >= 0; i--) {
        if (open[i].name === name) {
          open.length = i;
          break;
        }
      }
    } else if (!VOID_ELEMENTS.has(name)) {
      const parent = open[open.length - 1];
      const classes = classesOf(markup[0]);
      open.push({
        name,
        isChrist: (parent?.isChrist ?? false) || classes.includes('christ-words'),
        isDivine: (parent?.isDivine ?? false) || classes.includes('divine-name'),
      });
    }
  }
  addText(verseHTML.slice(last));

  return words;
}

/**
 * Extract words from verse HTML (simple version, strips formatting): tags are
 * removed and the text is split on whitespace, punctuation trimmed.
 *
 * @example
 * extractWords('<sup>16</sup> For God so loved the <em>world</em>')
 * // -> ['16', 'For', 'God', 'so', 'loved', 'the', 'world']
 */
export function extractWords(verseHTML: string): string[] {
  return extractWordsWithFormatting(verseHTML).map(w => w.text);
}

/**
 * Total number of words across a run of verse HTML strings.
 *
 * @param verses Verse HTML strings
 */
export function countWordsInRange(verses: string[]): number {
  return verses.reduce((count, verseHTML) => count + extractWords(verseHTML).length, 0);
}
