/**
 * The Word study module's code (lazy chunk): what `activate()` adds to the host.
 * It loads when the Word study tab or phone view first opens.
 *
 * - a request handler for the `wordStudy` pane, so Strong's popup and dictionary
 *   "Word study" buttons (host code, through `openPane`) can start a study.
 */
import './word-study.scss';
import type { FeatureModuleContext, WordGroup } from '@bible/core/browser';
import { registerPaneRequestHandler } from '../../host/paneRequests';
import { wordStudyStore } from './wordStudyStore';

/** What a host entry point can ask the pane to study (`openPane('wordStudy', request)`). */
export interface WordStudyRequest {
  strongs?: string;
  group?: WordGroup;
}

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  ctx.subscriptions.push(
    registerPaneRequestHandler('wordStudy', (request) => {
      const target = request as WordStudyRequest;
      if (target?.strongs) void wordStudyStore.openStrongs(target.strongs);
      else if (target?.group) void wordStudyStore.openGroup(target.group);
    }),
  );
}
