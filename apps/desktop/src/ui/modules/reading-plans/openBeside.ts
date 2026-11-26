/**
 * "Open beside the Bible" (task 0222 R3-8): the Reading plans pane docked to the right of the Bible the user was
 * reading, so a plan and its passage are on screen together. Reuses an open Reading plans pane.
 */
import { openApp } from '../../apps/appHost';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { genericEnglishTitle } from '../../utils/paneNames';

export async function openReadingPlansBeside(): Promise<void> {
  await openApp('study');
  const layout = useLayoutStore.getState(); // allow-getstate: imperative panel creation
  for (const [panelId, panel] of layout.panels) {
    if (panel.contentType !== 'reading-plans') continue;
    const dock = layout.dockviewApi?.getPanel(panelId);
    if (dock) { dock.api.setActive(); return; }
  }
  const api = layout.dockviewApi;
  const anchor = layout.lastActiveBiblePanelId && api?.getPanel(layout.lastActiveBiblePanelId) ? layout.lastActiveBiblePanelId : null;
  layout.addPanel(
    'reading-plans', undefined, genericEnglishTitle('reading-plans'),
    anchor ? { referencePanel: anchor, direction: 'right' } : { direction: 'right' },
    undefined, undefined, { initialWidth: 380 },
  );
}
