import type { StudyModeViewProps } from '../../host/slots';
import { GenealogyPane } from './GenealogyPane';
import type { FamilyTreeFocus } from './GenealogyPane';
import { getGenealogyProvider } from './genealogyProvider';
import './genealogy.scss';

/** The Study pane's Family tree mode and the phone sheet's body. */
export default function FamilyTreeView({ focus, onOpenVerse, compact }: StudyModeViewProps) {
  return <GenealogyPane provider={getGenealogyProvider()} focus={focus as FamilyTreeFocus | null} compact={compact} onOpenVerse={onOpenVerse} />;
}
