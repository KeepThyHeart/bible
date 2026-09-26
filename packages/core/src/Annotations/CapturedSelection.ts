/**
 * Turning a live DOM text selection into verse/word indices, and remembering
 * one across a menu interaction.
 *
 * Separate copies of this mapping in HighlightSelector, the context-menu
 * branch in BiblePaneOverlays, and buildSelectionFromDOM in useBibleHighlights
 * would disagree about what "the selection" is. There is one selection per
 * document, so there is one implementation of reading it here.
 *
 * Core is compiled without the DOM lib, so this file describes the handful of
 * DOM members it touches as small structural interfaces (`WordElementLike`,
 * `RangeLike`, `ParentNodeLike`) instead of importing `Range`/`HTMLElement`.
 * Real DOM objects satisfy them, so callers pass a `Range` / `HTMLElement` /
 * `Document` exactly as before.
 */

/** The attribute reads this module needs from a DOM element. Structural: satisfied by `HTMLElement`. */
export interface ElementLike {
  getAttribute(name: string): string | null;
}

/** A `.word` element: attributes plus the `closest('[data-verse-id]')` lookup. Satisfied by `HTMLElement`. */
export interface WordElementLike extends ElementLike {
  closest(selector: string): ElementLike | null;
}

/** The slice of `Range` used here. Satisfied by `Range`. */
export interface RangeLike {
  // The parameter is deliberately loose: a real `Range` wants a `Node`, and a
  // `WordElementLike` is one at runtime but not in this file's DOM-free types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  intersectsNode(node: any): boolean;
}

/** The slice of `ParentNode` used here. Satisfied by `Document`/`HTMLElement`. */
export interface ParentNodeLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  querySelectorAll(selector: string): { forEach(callback: (element: any) => void): void };
}

interface SelectionLike {
  isCollapsed: boolean;
  rangeCount: number;
  getRangeAt(index: number): RangeLike;
}

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
export function selectedWordElements<E extends WordElementLike = WordElementLike>(
  range: RangeLike,
  root: ParentNodeLike,
): E[] {
  const words: E[] = [];
  root.querySelectorAll('.word').forEach((word) => {
    const element = word as E;
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
export function wordSelectionFromElements(words: readonly WordElementLike[]): WordSelectionRange | null {
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
export function readWordSelection(root: ParentNodeLike): WordSelectionRange | null {
  const host = globalThis as { getSelection?: () => SelectionLike | null };
  const selection = host.getSelection?.();
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
export function captureWordSelection(root: ParentNodeLike): WordSelectionRange | null {
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
