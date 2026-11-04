/**
 * The annotations reader controller (`readerPaintControllers`): mounted by `BibleContent` with the chapter in view.
 * It tells the store which chapter this tab shows (module id and verse range), so the chapter's highlights, notes and
 * bookmarks are fetched once and kept fresh, The module re-renders the reader's verse decorations when the store changes.
 * The web reader draws no paint-layer gutter, so the marks come from the verse decorator's rail (highlightDecorator).
 */
import { useEffect, useMemo } from 'preact/hooks';
import type { ReaderPaintProps } from '../../host/slots';
import { annotationStore } from './instance';

export function chapterRange(verses: ReaderPaintProps['verses']): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const v of verses) {
    if (v.verse_id < start) start = v.verse_id;
    if (v.verse_id > end) end = v.verse_id;
  }
  return start <= end ? { start, end } : null;
}

export function AnnotationPaint({ tabId, moduleId, verses }: ReaderPaintProps) {
  const range = useMemo(() => chapterRange(verses), [verses]);
  const start = range?.start;
  const end = range?.end;
  useEffect(() => {
    if (moduleId === undefined || start === undefined || end === undefined) return;
    return annotationStore.watch(tabId, moduleId, start, end);
  }, [tabId, moduleId, start, end]);
  return null;
}
