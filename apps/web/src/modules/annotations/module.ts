/**
 * The Annotations module's code (lazy chunk): what `activate()` adds to the host. Loaded after first paint (boot
 * probe) or when a verse action first runs. Nothing is registered where the browser cannot open the local user DB.
 *
 * - defines the context key `userDb.available` (the verse menu entries' `when`);
 * - `readerPaintControllers`: tells the store which chapter each tab shows;
 * - `verseDecorators`: highlight tint and the note/bookmark marks;
 * - `shellOverlays`: the highlight popover, the note dialog and the toast.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { readerPaintControllers, shellOverlays, verseDecorators } from '../../host/slots';
import { registerWhenKey, whenKeys } from '../../host/verseActionWhen';
import { AnnotationOverlay } from './AnnotationOverlay';
import { AnnotationPaint } from './AnnotationPaint';
import { isUserDbSupported, subscribeChanged } from './annotationApi';
import { annotationUi } from './annotationUi';
import { createHighlightDecorator } from './highlightDecorator';
import { annotationStore } from './instance';
import './annotations.scss';

export function activate(ctx: FeatureModuleContext): void {
  const available = isUserDbSupported();
  ctx.subscriptions.push(registerWhenKey('userDb.available', () => available));
  if (!available) return;
  ctx.subscriptions.push(
    readerPaintControllers.register(AnnotationPaint),
    verseDecorators.register(createHighlightDecorator(annotationStore)),
    shellOverlays.register(AnnotationOverlay),
    // Cache changes re-render the verses; the worker's `changed` events (other tabs, sync pulls) refresh the cache.
    { dispose: annotationStore.subscribe(() => verseDecorators.invalidate()) },
    { dispose: annotationStore.listen(subscribeChanged) },
    { dispose: () => annotationUi.reset() },
    { dispose: () => whenKeys.invalidate() },
  );
}
