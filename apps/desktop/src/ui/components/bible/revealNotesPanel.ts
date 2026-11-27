import { useLayoutStore, type PanelContentType } from '../../stores/useLayoutStore';
import { rightHandPosition } from '../../utils/rightHandGroup';

/**
 * Panes that make up the workbench's right-hand group in the first-run layout
 * (see `createDefaultLayout` in DockviewLayout). A Notes pane opened from the
 * Bible pane joins whichever of these is already on screen, so the passage the
 * reader is looking at keeps its width instead of being split again.
 */
const RIGHT_HAND_TYPES: PanelContentType[] = ['study', 'commentary', 'dictionary', 'book'];

/**
 * Make a Notes pane visible, creating one if the layout has none, and return
 * its panel id (or `null` if dockview could not add it).
 *
 * The note indicator on a verse advertises "click to view the note", but until
 * now the click only poked the notes *store*: if no Notes pane happened to be
 * open - and the default layout opens none - nothing appeared, and if one was
 * open but sat behind another tab it stayed behind it. Revealing the pane is
 * the missing half of that gesture.
 *
 * Kept out of `useLayoutStore` deliberately: this is Bible-pane policy about
 * *where* notes should appear, not layout mechanics, and the store's existing
 * `getPanelsByType` / `addPanel` / `dockviewApi` are enough to express it.
 */
export function revealNotesPanel(): string | null {
  const layout = useLayoutStore.getState(); // allow-getstate: event handler - imperative panel lookup outside render
  const api = layout.dockviewApi;

  const existing = layout.getPanelsByType('notes');
  if (existing.length > 0) {
    const panelId = existing[0].panelId;
    // Bring it to the front of its group; a Notes pane hidden behind the
    // Commentary tab is as good as absent to the person who just clicked.
    api?.getPanel(panelId)?.api.setActive();
    return panelId;
  }

  return layout.addPanel('notes', undefined, 'Notes', rightHandPosition(RIGHT_HAND_TYPES));
}

