/**
 * The keyword marks reader paint controller: mounted by `BibleContent` (slot
 * `readerPaintControllers`) with the chapter in view. It matches the active sets and
 * publishes their paint layer to the host, which resolves it with other modules' layers.
 */
import { useLayoutEffect } from 'preact/hooks';
import type { ReaderPaintProps } from '../../host/slots';
import { publishReaderLayer } from '../../host/readerLayers';
import { useKeywordDecorations } from './useKeywordDecorations';
import { KEYWORD_PANE_ID } from './paneId';

const SOURCE_ID = 'keyword-marks';
/** Resolves before the measures layer (order 20), as the two always merged. */
const ORDER = 10;

export function KeywordPaint(props: ReaderPaintProps) {
  const { tabId, moduleAbbr, moduleId, language, book, chapter, verses, surface, studyRows, interlinearProvider } = props;
  const marks = useKeywordDecorations(KEYWORD_PANE_ID, {
    moduleAbbr, moduleId, language, book, chapter, verses, surface, studyRows, interlinearProvider,
  });
  const layer = marks?.layer ?? null;
  // Layout effects: the host re-renders in a microtask, before paint, so there is no flash.
  useLayoutEffect(() => {
    publishReaderLayer(tabId, SOURCE_ID, ORDER, layer);
  }, [tabId, layer]);
  useLayoutEffect(() => () => publishReaderLayer(tabId, SOURCE_ID, ORDER, null), [tabId]);
  return null;
}
