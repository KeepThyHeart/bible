/**
 * Turning a live DOM text selection into verse/word indices, and remembering
 * one across a menu interaction.
 *
 * Separate copies of this mapping in HighlightSelector, the context-menu
 * branch in BiblePaneOverlays, and buildSelectionFromDOM in useBibleHighlights
 * would disagree about what "the selection" is. There is one selection per
 * document, so there is one implementation of reading it here.
 */

export interface WordSelectionRange {
  startVerseId: number;
  startWordIndex: number;
  /** Undefined when the selection stays inside a single verse. */
  endVerseId?: number;
  endWordIndex?: number;
}

/**
 * The `.word` elements under `root` that `range` touches, in document order.
 *
 * `root` matters: querying `document` picks up words from *every* Bible pane on
 * screen, so a two-pane layout would build a selection spanning both.
 */
export function selectedWordElements(range: Range, root: ParentNode): HTMLElement[] {
  const words: HTMLElement[] = [];
  root.querySelectorAll('.word').forEach((word) => {
    const element = word as HTMLElement;
    if (range.intersectsNode(element)) {
      words.push(element);
    }
  });
  return words;
}

/**
 * Map a run of selected `.word` elements onto verse ids and word indices.
 * Returns null when the words carry no verse context to anchor them to.
 *
 * Every renderer in the app emits one `.word` per English word, so
 * `data-word-index` on the last element is the end of the range. A renderer
 * that ever spans several words with one element (a cell-granular interlinear
 * fallback, say) must say so via `data-word-index-end`, which is preferred here
 * - otherwise the selection would silently truncate to that element's first
 * word.
 */
export function wordSelectionFromElements(words: HTMLElement[]): WordSelectionRange | null {
  if (words.length === 0) return null;

  const firstWord = words[0];
  const firstVerseEl = firstWord.closest('[data-verse-id]');
  if (!firstVerseEl) return null;

  const lastWord = words[words.length - 1];
  const lastVerseEl = lastWord.closest('[data-verse-id]');
  if (!lastVerseEl) return null;

  const startVerseId = parseInt(firstVerseEl.getAttribute('data-verse-id') || '0', 10);
  const endVerseId = parseInt(lastVerseEl.getAttribute('data-verse-id') || '0', 10);
  const startWordIndex = parseInt(firstWord.getAttribute('data-word-index') || '0', 10);
  const endWordIndex = parseInt(
    lastWord.getAttribute('data-word-index-end') ?? lastWord.getAttribute('data-word-index') ?? '0',
    10
  );

  return {
    startVerseId,
    startWordIndex,
    endVerseId: startVerseId === endVerseId ? undefined : endVerseId,
    endWordIndex,
  };
}

/** Read the live DOM selection as a word range, or null if there isn't one. */
export function readWordSelection(root: ParentNode): WordSelectionRange | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  return wordSelectionFromElements(selectedWordElements(selection.getRangeAt(0), root));
}

/*
  The selection that was live when a verse context menu opened.

  The menu reads the selection *later* - after the user has clicked "Highlight/
  Underline..." - and a mousedown on the way there can collapse it. When that
  happens the caller sees `isCollapsed === true` and silently falls back to
  "highlight the entire verse", so picking three words highlights the whole
  verse. Whoever opens the menu snapshots the words here instead, and the menu
  acts on the snapshot rather than on whatever survived the click.
*/
let captured: WordSelectionRange | null = null;

/**
 * Snapshot the current selection for a context menu that is about to open.
 * Always overwrites - including with null - so a menu opened with nothing
 * selected can never act on a previous menu's leftovers.
 */
export function captureWordSelection(root: ParentNode): WordSelectionRange | null {
  captured = readWordSelection(root);
  return captured;
}

/** Consume the snapshot taken when the menu opened. Reading it clears it. */
export function takeCapturedWordSelection(): WordSelectionRange | null {
  const value = captured;
  captured = null;
  return value;
}

/** Discard any snapshot (menu dismissed without choosing a highlight). */
export function clearCapturedWordSelection(): void {
  captured = null;
}
