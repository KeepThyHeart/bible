import { presentStore } from '../../stores/presentStore';
import { PresentPanelBody } from './PresentPanelBody';

/**
 * The floating popup behind the strip's last button -- a phone, or any layout
 * with no permanent place to put the running order and the join panel.
 *
 * On desktop the same content lives directly in the Present tab instead (see
 * `PresentTab`); this wrapper is what turns it into a dismissible popup.
 *
 * Not currently reachable: the Present tab (desktop's Study-pane tab and
 * mobile's root-level tab) now fully supersedes this popup, and every button
 * that used to open it (the header's TV button, the strip's list-toggle
 * button) reveals the tab directly instead. Left in place, not deleted, as a
 * fallback for a future layout with nowhere to put a persistent tab -- this
 * is a deliberate decision from the human, not dead code nobody noticed; see
 * task 0005-bible-presenter's thread for the discussion.
 */
export function PresentPanel(props: { compact?: boolean }) {
  return <PresentPanelBody compact={props.compact} onClose={() => presentStore.setPanelOpen(false)} />;
}
