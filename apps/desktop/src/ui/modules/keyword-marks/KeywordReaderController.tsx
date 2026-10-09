/**
 * The keyword-marks paint controller (`readerPaintControllers` slot): keeps this tab's keyword-mark
 * match current for the chapter on screen. Draws nothing; the marks reach the verses through the
 * chapter-layer store (`publish.ts`).
 */
import type { ReaderPaintProps } from '../host/slots';
import { useKeywordChapterSync } from './useKeywordChapterSync';

export function KeywordReaderController(p: ReaderPaintProps): null {
  useKeywordChapterSync({
    tabId: p.tabId,
    moduleId: p.moduleId,
    abbreviation: p.abbreviation,
    language: p.language,
    bookNumber: p.bookNumber,
    chapter: p.chapter,
    verses: p.verses,
    active: p.active,
  });
  return null;
}
