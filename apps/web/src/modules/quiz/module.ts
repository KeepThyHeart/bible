/**
 * The Quiz module's code (lazy chunk): what `activate()` adds to the host.
 * It loads when the Quiz tab or app first opens, or when the phone Study pane
 * mounts (`onView:studyPane.sections`).
 *
 * - the phone Study pane's "Quiz this chapter" section, through the
 *   `studyPaneSections` slot.
 */
import './quiz.scss';
import type { FeatureModuleContext } from '@bible/core/browser';
import { studyPaneSections } from '../../host/slots';
import { QuizSection } from './QuizSection';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  ctx.subscriptions.push(studyPaneSections.register(QuizSection));
}
