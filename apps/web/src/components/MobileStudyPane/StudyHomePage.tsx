import { ConnectionSvg, CategoryManagementSvg, CommentOneSvg, BookOpenSvg, TranslateSvg, NotepadSvg } from '../common/inlineIcons';
import { useTranslation } from 'react-i18next';
import { settingsStore } from '../../stores/settingsStore';
import { useStore } from '../../hooks/useStore';

export type StudySubPage = 'crossrefs' | 'topics' | 'commentary' | 'dictionary' | 'interlinear' | 'summary';

interface StudyHomePageProps {
  onNavigate: (page: StudySubPage) => void;
}

interface StudyCard {
  id: StudySubPage;
  labelKey: string;
  iconSvg: string;
  colorClass: string;
}

// Shared card definitions
const CARD_SUMMARY: StudyCard = {
  id: 'summary',
  labelKey: 'studyHomePage.commentarySummary',
  iconSvg: NotepadSvg,
  colorClass: 'study-home-grid__card--teal',
};
const CARD_CROSSREFS: StudyCard = {
  id: 'crossrefs',
  labelKey: 'studyHomePage.crossReferences',
  iconSvg: ConnectionSvg,
  colorClass: 'study-home-grid__card--blue',
};
const CARD_TOPICS: StudyCard = {
  id: 'topics',
  labelKey: 'studyHomePage.topics',
  iconSvg: CategoryManagementSvg,
  colorClass: 'study-home-grid__card--green',
};
const CARD_COMMENTARY: StudyCard = {
  id: 'commentary',
  labelKey: 'studyHomePage.commentary',
  iconSvg: CommentOneSvg,
  colorClass: 'study-home-grid__card--orange',
};
const CARD_DICTIONARY: StudyCard = {
  id: 'dictionary',
  labelKey: 'studyHomePage.dictionary',
  iconSvg: BookOpenSvg,
  colorClass: 'study-home-grid__card--purple',
};
const CARD_INTERLINEAR: StudyCard = {
  id: 'interlinear',
  labelKey: 'studyHomePage.interlinear',
  iconSvg: TranslateSvg,
  colorClass: 'study-home-grid__card--red',
};

// Right-handed layout: most-used items on right side, bottom is easiest thumb reach
const CARDS_RIGHT_HANDED: StudyCard[] = [
  CARD_CROSSREFS, CARD_TOPICS,
  CARD_COMMENTARY, CARD_DICTIONARY,
  CARD_INTERLINEAR, CARD_SUMMARY,
];

// Left-handed layout: mirrored (Summary bottom-left for left thumb)
const CARDS_LEFT_HANDED: StudyCard[] = [
  CARD_TOPICS, CARD_CROSSREFS,
  CARD_DICTIONARY, CARD_COMMENTARY,
  CARD_SUMMARY, CARD_INTERLINEAR,
];

export function StudyHomePage({ onNavigate }: StudyHomePageProps) {
  const { t } = useTranslation();
  const leftHanded = useStore(settingsStore, () => settingsStore.leftHandedMode);
  const cards = leftHanded ? CARDS_LEFT_HANDED : CARDS_RIGHT_HANDED;

  return (
    <div class="study-home-grid">
      {cards.map((card) => (
        <button
          key={card.id}
          class={`study-home-grid__card ${card.colorClass}`}
          onClick={() => onNavigate(card.id)}
        >
          <span class="study-home-grid__icon" dangerouslySetInnerHTML={{ __html: card.iconSvg }} />
          <span class="study-home-grid__label">{t(card.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
