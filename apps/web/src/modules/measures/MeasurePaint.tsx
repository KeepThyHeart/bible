/**
 * The measures reader paint controller: mounted by `BibleContent` (slot
 * `readerPaintControllers`) with the chapter in view. It computes the chapter's
 * weights, measures and money notes, publishes their paint layer to the host
 * (merged there with other modules' layers) and renders the hover/tap popup.
 */
import { useLayoutEffect } from 'preact/hooks';
import type { ReaderPaintProps } from '../../host/slots';
import { publishReaderLayer } from '../../host/readerLayers';
import { useMeasureDecorations } from './useMeasureDecorations';
import { useMeasurePopup } from './useMeasurePopup';

const SOURCE_ID = 'measures';
/** Resolves after the keyword marks layer (order 10), as the two always merged. */
const ORDER = 20;

export function MeasurePaint(props: ReaderPaintProps) {
  const { tabId, book, chapter, verses, language, surface, studyRows, uiLocale, container, onOpenSettings } = props;
  const measures = useMeasureDecorations({ book, chapter, verses, moduleLanguage: language, surface, studyRows, uiLocale });
  const layer = measures?.layer ?? null;
  // Layout effects: the host re-renders in a microtask, before paint, so there is no flash.
  useLayoutEffect(() => {
    publishReaderLayer(tabId, SOURCE_ID, ORDER, layer);
  }, [tabId, layer]);
  useLayoutEffect(() => () => publishReaderLayer(tabId, SOURCE_ID, ORDER, null), [tabId]);
  const popup = useMeasurePopup(measures, container, onOpenSettings);
  return <>{popup.popup}</>;
}
