/**
 * Weights, measures and money, lazy half (activated by `onView:bible`, when the reader or the Study
 * pane first shows): registers the paint controller (marks + popup) and the Study section, and starts
 * publishing the tab layers. Everything goes into `ctx.subscriptions`, so deactivating (or switching
 * the module off) removes it and withdraws every published layer.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { readerPaintControllers, studyPaneSections } from '../host/slots';
import { MeasureReaderController } from './MeasureReaderController';
import { MeasuresStudyPaneSection } from './MeasuresStudyPaneSection';
import { startMeasureLayerPublishing } from './publish';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  ctx.subscriptions.push(
    startMeasureLayerPublishing(),
    readerPaintControllers.register(MeasureReaderController),
    studyPaneSections.register(MeasuresStudyPaneSection),
  );
}
