/**
 * Tokenising verse HTML into indexed words.
 *
 * Ported from the desktop app's `src/ui/utils/wordIndexing.ts`. Only the
 * extraction half came across: the desktop file's DOM-walking helpers exist to
 * serve its highlight/underline markup, which the web app does not have.
 *
 * The token sequence produced here is the index space
 * `interlinear_word.word_position_start` / `word_position_end` address, so it
 * has to be derived from the same `text_html` the reader sees — see
 * `interlinearCells.ts` for why that matters.
 *
 * NOTE: duplicated rather than shared with desktop. Moving it into
 * `@bible/core` would mean editing that package's barrel exports, which is out
 * of scope for this change.
 */

/** One whitespace-separated word of a verse, with the formatting it inherited. */
export interface WordInfo {
  /** Word with surrounding punctuation stripped — the matching/indexing form. */
  text: string;
  /** Word exactly as it appears, punctuation included — the rendering form. */
  displayText: string;
  isChristWords: boolean;
  /**
   * Word sits inside a `<span class="divine-name">` — the small-caps treatment
   * applied to the Tetragrammaton. Tracked because flattening the HTML to
   * tokens would otherwise lose it, and the interlinear renderer builds its
   * output from these tokens rather than re-emitting the source HTML.
   */
  isDivineName: boolean;
  hasTrailingSpace: boolean;
}

/**
 * Split verse HTML into words, carrying each word's formatting flags along.
 *
 * @param verseHTML Verse display HTML (`verse.text_html`)
 *
 * @example
 * extractWordsWithFormatting('<span class="christ-words">I am</span> he')
 * // -> [{ text: 'I', isChristWords: true, ... }, ...]
 */
export function extractWordsWithFormatting(verseHTML: string): WordInfo[] {
  const words: WordInfo[] = [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${verseHTML}</div>`, 'text/html');
  const container = doc.body.firstChild as HTMLElement | null;
  if (!container) return [];

  const processNode = (node: Node, isInChristWords: boolean, isInDivineName: boolean): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = node.textContent || '';

      // Leading whitespace belongs to the previous word: element boundaries
      // split a single space across two text nodes.
      if (text.length > 0 && /^\s/.test(text) && words.length > 0) {
        words[words.length - 1].hasTrailingSpace = true;
      }

      const pattern = /(\S+)(\s*)/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const rawWord = match[1];
        const trailingSpace = match[2];
        if (!rawWord) continue;

        // Strip leading/trailing punctuation for the indexing form, keeping
        // apostrophes inside words so contractions stay one token.
        const wordMatch = rawWord.match(/^([^\w']*)([\w']+)([^\w']*)$/);
        if (wordMatch && wordMatch[2].length > 0) {
          words.push({
            text: wordMatch[2],
            displayText: rawWord,
            isChristWords: isInChristWords,
            isDivineName: isInDivineName,
            hasTrailingSpace: trailingSpace.length > 0,
          });
        } else {
          // Pure punctuation — still a token, so indices stay aligned with the
          // importer's whitespace split.
          words.push({
            text: rawWord,
            displayText: rawWord,
            isChristWords: isInChristWords,
            isDivineName: isInDivineName,
            hasTrailingSpace: trailingSpace.length > 0,
          });
        }
      }
    } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
      const element = node as HTMLElement;
      const isChrist = isInChristWords || element.classList.contains('christ-words');
      const isDivine = isInDivineName || element.classList.contains('divine-name');
      node.childNodes.forEach(child => processNode(child, isChrist, isDivine));
    }
  };

  processNode(container, false, false);
  return words;
}
