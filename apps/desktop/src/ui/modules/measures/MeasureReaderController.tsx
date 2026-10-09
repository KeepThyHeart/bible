/**
 * The weights-and-measures paint controller (`readerPaintControllers` slot): keeps this tab's marks
 * current for the chapter on screen (Reading stays clean unless the reader opted in - the core layer
 * builder decides) and owns the hover/click popup on the text container.
 */
import React from 'react';
import type { ReaderPaintProps } from '../host/slots';
import { useMeasureChapterSync } from './useMeasureChapterSync';
import { useMeasureWordPopup } from './useMeasureWordPopup';

export function MeasureReaderController(p: ReaderPaintProps): React.ReactElement {
  useMeasureChapterSync({
    tabId: p.tabId,
    moduleId: p.moduleId,
    abbreviation: p.abbreviation,
    language: p.language,
    bookNumber: p.bookNumber,
    chapter: p.chapter,
    verses: p.verses,
    surface: p.surface,
    uiLocale: p.uiLocale,
    active: p.active,
  });
  const popup = useMeasureWordPopup(p.tabId, p.containerRef);
  return <>{popup.popup}</>;
}
