/**
 * Word indexing utilities for text markup (highlighting, underlining, etc.)
 *
 * This module provides functions for extracting words from Bible verse HTML,
 * indexing them, and navigating the DOM to find word and verse elements.
 */

/**
 * Word with metadata about formatting
 */
export interface WordInfo {
  text: string;           // Clean word text (without punctuation) - used for indexing/matching
  displayText: string;    // Full text including punctuation - used for rendering
  isChristWords: boolean;
  /**
   * Word sits inside a `<span class="divine-name">` - the small-caps treatment
   * `formatVerseText()` applies to the Tetragrammaton. Tracked alongside
   * `isChristWords` because flattening the HTML to tokens otherwise loses it,
   * and the interlinear renderer builds JSX from these tokens rather than
   * re-emitting the source HTML.
   */
  isDivineName: boolean;
  hasTrailingSpace: boolean;
}

/**
 * Extract words from verse HTML text with formatting information
 * Identifies which words are Christ's words (red-letter text)
 *
 * @param verseHTML - HTML content of the verse
 * @returns Array of WordInfo objects with text and formatting metadata
 *
 * @example
 * extractWordsWithFormatting('<span class="christ-words">For God</span> so loved')
 * // Returns: [
 * //   { text: 'For', isChristWords: true },
 * //   { text: 'God', isChristWords: true },
 * //   { text: 'so', isChristWords: false },
 * //   { text: 'loved', isChristWords: false }
 * // ]
 */
export function extractWordsWithFormatting(verseHTML: string): WordInfo[] {
  const words: WordInfo[] = [];

  // Create a temporary DOM parser
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${verseHTML}</div>`, 'text/html');
  const container = doc.body.firstChild as HTMLElement;

  if (!container) {
    return [];
  }

  // Recursively extract text nodes and check if they're in christ-words spans
  function processNode(node: Node, isInChristWords: boolean, isInDivineName: boolean) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Text node - extract words while preserving trailing space information
      const text = node.textContent || '';

      // Check if this text node starts with whitespace
      // If so, mark the previous word as having trailing space
      if (text.length > 0 && /^\s/.test(text) && words.length > 0) {
        words[words.length - 1].hasTrailingSpace = true;
      }

      // Split on whitespace but keep track of spacing
      // Use a regex that captures words and the spaces after them
      const pattern = /(\S+)(\s*)/g;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const rawWord = match[1];
        const trailingSpace = match[2];

        if (rawWord.length > 0) {
          // KAN-10: Strip leading and trailing punctuation from words for indexing
          // Keep apostrophes within words (contractions like "can't")
          // displayText preserves punctuation for rendering, text is clean for matching
          const punctuationPattern = /^([^\w']*)([\w']+)([^\w']*)$/;
          const wordMatch = rawWord.match(punctuationPattern);

          if (wordMatch) {
            const cleanWord = wordMatch[2];

            // Add the word with both clean text (for indexing) and display text (with punctuation)
            if (cleanWord.length > 0) {
              words.push({
                text: cleanWord,                    // Clean word for highlight matching
                displayText: rawWord,               // Full word with punctuation for rendering
                isChristWords: isInChristWords,
                isDivineName: isInDivineName,
                // Has trailing space if there was trailing whitespace
                hasTrailingSpace: trailingSpace.length > 0
              });
            }
          } else {
            // No word characters found (pure punctuation) - still include for display
            // This handles cases like standalone punctuation marks or special characters
            words.push({
              text: rawWord,
              displayText: rawWord,
              isChristWords: isInChristWords,
              isDivineName: isInDivineName,
              hasTrailingSpace: trailingSpace.length > 0
            });
          }
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Element node - check if it's a christ-words span
      const element = node as HTMLElement;
      const isChrist = isInChristWords || element.classList.contains('christ-words');
      const isDivine = isInDivineName || element.classList.contains('divine-name');

      // Process children
      node.childNodes.forEach(child => processNode(child, isChrist, isDivine));
    }
  }

  processNode(container, false, false);

  return words;
}

/**
 * Extract words from verse HTML text (simple version, strips formatting)
 * Strips all HTML tags and splits on whitespace
 *
 * @param verseHTML - HTML content of the verse
 * @returns Array of words (strings)
 *
 * @example
 * extractWords('<sup>16</sup> For God so loved the <em>world</em>')
 * // Returns: ['For', 'God', 'so', 'loved', 'the', 'world']
 */
export function extractWords(verseHTML: string): string[] {
  // Use the enhanced version and just return the text
  return extractWordsWithFormatting(verseHTML).map(w => w.text);
}

/**
 * Get word index from a word element in the DOM
 *
 * @param wordElement - DOM element with data-word-index attribute
 * @returns Word index (0-based) or -1 if not found
 */
export function getWordIndex(wordElement: Element): number {
  const index = wordElement.getAttribute('data-word-index');
  return index ? parseInt(index, 10) : -1;
}

/**
 * Get verse ID from a verse element in the DOM
 *
 * @param verseElement - DOM element with data-verse-id attribute
 * @returns Verse ID or null if not found
 */
export function getVerseId(verseElement: Element): number | null {
  const id = verseElement.getAttribute('data-verse-id');
  return id ? parseInt(id, 10) : null;
}

/**
 * Find the closest word element from a mouse event target
 *
 * @param target - Event target element
 * @returns Word element or null if not found
 */
export function findWordElement(target: Element): Element | null {
  // Check if target itself is a word element
  if (target.classList.contains('word') || target.hasAttribute('data-word-index')) {
    return target;
  }

  // Search up the DOM tree
  return target.closest('[data-word-index]');
}

/**
 * Find the closest verse element from a mouse event target
 *
 * @param target - Event target element
 * @returns Verse element or null if not found
 */
export function findVerseElement(target: Element): Element | null {
  return target.closest('[data-verse-id]');
}

/**
 * Calculate total number of words in a verse range
 *
 * @param verses - Array of verse HTML strings
 * @returns Total word count
 */
export function countWordsInRange(verses: string[]): number {
  return verses.reduce((count, verseHTML) => {
    return count + extractWords(verseHTML).length;
  }, 0);
}
