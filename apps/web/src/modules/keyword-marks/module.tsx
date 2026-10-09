/**
 * Keyword marks module code (lazy): the reader paint controller (the marks in the text)
 * and the toolbar's "Keywords" button with its legend. Both register into generic host
 * slots and are removed again when the module switches off.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { readerPaintControllers, readerToolbarItems } from '../../host/slots';
import { KeywordMarksButton } from './KeywordMarksButton';
import { KeywordPaint } from './KeywordPaint';
import './keyword-marks.scss';

export function activate(ctx: FeatureModuleContext): void {
  ctx.subscriptions.push(
    readerPaintControllers.register(KeywordPaint),
    readerToolbarItems.register(KeywordMarksButton),
  );
}
