/**
 * The Word study module's code (lazy chunk): what `activate()` adds to the host. It loads when a
 * Word study panel first mounts, when a host button or command asks for one, or when the verse
 * context menu opens (`onView:verseContextMenu`).
 *
 * - the panel request handler (Dictionary pane, Strong's tooltip and the palette command ask for
 *   the pane through `requestPanel`);
 * - the "Study word" entry of the verse context menu (`verseMenuItems` slot): it needs the selected
 *   word, which a verse action's context does not carry;
 * - the disposer for a closed pane's state;
 * - the pane state saved in the session (restored from the staged session blob when this code loads).
 */
import type { FeatureModuleContext, WordStudySubject } from '@bible/core/browser';
import { registerPanelRequestHandler } from '../host/panelRequests';
import { verseMenuItems } from '../host/slots';
import { registerPanelDisposer } from '../../stores/helpers/panelDisposal';
import { StudyWordMenuItem } from './StudyWordMenuItem';
import { revealWordStudyPanel } from './revealWordStudyPanel';
import { useWordStudyStore } from './useWordStudyStore';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  ctx.subscriptions.push(
    registerPanelRequestHandler('wordStudy', (request) => {
      revealWordStudyPanel(request as WordStudySubject | undefined);
    }),
    registerPanelDisposer('wordStudy', (panelId) => {
      // allow-getstate: dockview event callback - runs outside React render
      useWordStudyStore.getState().destroyPanel(panelId);
    }),
    verseMenuItems.register(StudyWordMenuItem),
  );
}
