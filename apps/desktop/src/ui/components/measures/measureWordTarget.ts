/** DOM glue for the weights-and-measures popups (task 0069): which measure word, if any, an event is on. */
import type { MeasurePopupModel } from '@bible/core/browser';
import { measureModelsAt, type MeasureChapter } from '../../extensions/measureLayer';

export interface MeasureWordHit {
  verseId: number;
  wordIndex: number;
  element: Element;
  models: MeasurePopupModel[];
}

/** The `.word[data-word-index]` an event target is in (or is), with its verse id; `null` when it is not a word. */
export function wordOf(target: EventTarget | null): { element: Element; verseId: number; wordIndex: number } | null {
  const el = (target as Element | null)?.closest?.('.word[data-word-index]');
  if (!el) return null;
  const verseEl = el.closest('[data-verse-id]');
  const verseId = Number(verseEl?.getAttribute('data-verse-id'));
  const wordIndex = Number(el.getAttribute('data-word-index'));
  if (!Number.isFinite(verseId) || !Number.isFinite(wordIndex)) return null;
  return { element: el, verseId, wordIndex };
}

/** The measure word under an event target: a word whose (verse, index) the chapter's index holds occurrences for. */
export function measureWordAt(target: EventTarget | null, chapter: MeasureChapter | undefined): MeasureWordHit | null {
  if (!chapter) return null;
  const word = wordOf(target);
  if (!word) return null;
  const models = measureModelsAt(chapter, word.verseId, word.wordIndex);
  return models.length > 0 ? { ...word, models } : null;
}
