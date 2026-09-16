import { presentStore } from '../../stores/presentStore';
import { PresentPanelBody } from './PresentPanelBody';

/**
 * The floating popup behind the strip's last button -- a phone, or any layout
 * with no permanent place to put the running order and the join panel.
 *
 * On desktop the same content lives directly in the Present tab instead (see
 * `PresentTab`); this wrapper is what turns it into a dismissible popup.
 */
export function PresentPanel(props: { compact?: boolean }) {
  return <PresentPanelBody compact={props.compact} onClose={() => presentStore.setPanelOpen(false)} />;
}
