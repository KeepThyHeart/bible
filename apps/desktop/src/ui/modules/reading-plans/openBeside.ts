/**
 * "Open beside the Bible" (task 0222 R3-8): the Reading plans pane as a tab of the right-hand group (with Study,
 * Commentary and the like), so a plan and its passage are on screen together. There is at most one: an open Reading
 * plans pane is brought forward instead. With no right-hand group yet it opens to the right of the Bible.
 */
import { openApp } from '../../apps/appHost';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { genericEnglishTitle } from '../../utils/paneNames';
import { rightHandPosition } from '../../utils/rightHandGroup';

export async function openReadingPlansBeside(): Promise<void> {
  await openApp('study');
  const layout = useLayoutStore.getState(); // allow-getstate: imperative panel creation
  for (const [panelId, panel] of layout.panels) {
    if (panel.contentType !== 'reading-plans') continue;
    const dock = layout.dockviewApi?.getPanel(panelId);
    if (dock) { dock.api.setActive(); return; }
  }
  const inGroup = rightHandPosition();
  if (inGroup) {
    const id = layout.addPanel('reading-plans', undefined, genericEnglishTitle('reading-plans'), inGroup);
    if (id) layout.dockviewApi?.getPanel(id)?.api.setActive();
    return;
  }
  const api = layout.dockviewApi;
  const anchor = layout.lastActiveBiblePanelId && api?.getPanel(layout.lastActiveBiblePanelId) ? layout.lastActiveBiblePanelId : null;
  layout.addPanel(
    'reading-plans', undefined, genericEnglishTitle('reading-plans'),
    anchor ? { referencePanel: anchor, direction: 'right' } : { direction: 'right' },
    undefined, undefined, { initialWidth: 380 },
  );
}
