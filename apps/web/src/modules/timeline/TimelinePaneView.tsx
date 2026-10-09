import type { PaneViewProps } from '../host/panes';
import { TimelinePane } from './TimelinePane';

/** The right-pane Timeline tab: `pane:timeline`. */
export default function TimelinePaneView(_props: PaneViewProps) {
  return <TimelinePane allowFullscreen />;
}
