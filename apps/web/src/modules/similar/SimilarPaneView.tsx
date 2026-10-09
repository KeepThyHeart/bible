import { SimilarPane } from './SimilarPane';
import type { PaneViewProps } from '../host/panes';

/** The right-pane view of the Similar tab (`pane:similar`): a default export taking the shell's pane props. */
export default function SimilarPaneView(p: PaneViewProps) {
  return <SimilarPane providers={p.providers} />;
}
