import { keywordMarkStore } from '../stores/keywordMarkStore';
import { bibleStore } from '../stores/bibleStore';
import type { WordPick } from './chapterMarks';

const WORD_CHAR = /[\p{L}\p{N}'’-]/u;

/** The word around `offset` in `text`, or ''. */
export function wordAround(text: string, offset: number): string {
  let a = Math.min(offset, text.length);
  let b = a;
  while (a > 0 && WORD_CHAR.test(text[a - 1])) a--;
  while (b < text.length && WORD_CHAR.test(text[b])) b++;
  return text.slice(a, b).replace(/^['’-]+|['’-]+$/g, '');
}

/** The Strong's number under word `index` of `verseId`, from the interlinear rows the store holds for the chapter in view. */
export function strongsForWord(verseId: number, index: number): string | undefined {
  const tab = bibleStore.getActiveTab?.();
  if (!tab) return undefined;
  const spans = keywordMarkStore.getInterlinear(`${tab.moduleAbbr}:${tab.book}:${tab.chapter}`);
  return spans?.find((s) => s.verseId === verseId && s.start <= index && index <= s.end && s.strongs)?.strongs;
}

interface CaretDoc {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

/**
 * The word a pointer event landed on inside a verse, with its Strong's number when known. Uses the
 * painted `.word` span when there is one (marks on), and the caret position in the text otherwise, so
 * the menu works with marks off too. Null when the point is not on a word.
 */
export function wordAtPoint(target: HTMLElement, clientX: number, clientY: number, verseId: number): WordPick | null {
  const span = target.closest?.('.word[data-word-index]') as HTMLElement | null;
  if (span) {
    const text = wordAround(span.textContent ?? '', 0) || (span.textContent ?? '').trim();
    if (!text) return null;
    const strongs = strongsForWord(verseId, Number(span.dataset.wordIndex));
    return { text, ...(strongs ? { strongs } : {}) };
  }
  const doc = document as unknown as CaretDoc;
  let node: Node | null | undefined;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(clientX, clientY);
  if (pos) { node = pos.offsetNode; offset = pos.offset; }
  else {
    const range = doc.caretRangeFromPoint?.(clientX, clientY);
    if (range) { node = range.startContainer; offset = range.startOffset; }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  if (!(node.parentElement?.closest('[data-verse-id]'))) return null;
  const text = wordAround(node.textContent ?? '', offset);
  return text ? { text } : null;
}
