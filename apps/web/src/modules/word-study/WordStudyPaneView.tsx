import './word-study.scss';
import type { PaneViewProps } from '../host/panes';
import { WordStudyPane } from './WordStudyPane';

/** The Word study view (`pane:wordStudy`): the right-pane tab and the phone full-screen view. */
export default function WordStudyPaneView(p: PaneViewProps) {
  return <WordStudyPane onOpenStrongsEntry={p.onStrongsClick} onNavigate={p.onNavigateBible} onClose={p.onClosePhone} />;
}
