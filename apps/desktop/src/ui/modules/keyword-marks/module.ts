/**
 * Keyword marks, lazy half (activated by `onView:bible`, when the reader first shows): puts the
 * paint controller, the toolbar button, the word items and the Strong's action into the host slots
 * and starts publishing the tab layers. Everything registered goes into `ctx.subscriptions`, so
 * deactivating (or switching the module off) removes it and withdraws every published layer.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import {
  readerPaintControllers,
  readerToolbarItems,
  strongsTooltipActions,
  wordMenuItems,
} from '../host/slots';
import { KeywordReaderController } from './KeywordReaderController';
import { KeywordStrongsTooltipAction, KeywordWordMenuItems } from './KeywordWordActions';
import { startKeywordLayerPublishing } from './publish';
import './keywordMarks.css';
import KeywordsButton from './KeywordsButton';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  ctx.subscriptions.push(
    startKeywordLayerPublishing(),
    readerPaintControllers.register(KeywordReaderController),
    readerToolbarItems.register(KeywordsButton),
    wordMenuItems.register(KeywordWordMenuItems),
    strongsTooltipActions.register(KeywordStrongsTooltipAction),
  );
}
