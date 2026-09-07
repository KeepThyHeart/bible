import { ConnectionSmallSvg, CategoryManagementSmallSvg, CommentOneSmallSvg, BookOpenSmallSvg } from '../common/inlineIcons';
import { useTranslation } from 'react-i18next';
import type { StudySubPage } from './StudyHomePage';

interface StudyTabBarProps {
  activePage: StudySubPage;
  onNavigate: (page: 'home' | StudySubPage) => void;
}

const TAB_ITEMS: Array<{ id: StudySubPage; labelKey: string; iconSvg: string }> = [
  { id: 'crossrefs', labelKey: 'studyTabBar.xrefs', iconSvg: ConnectionSmallSvg },
  { id: 'topics', labelKey: 'studyTabBar.topics', iconSvg: CategoryManagementSmallSvg },
  { id: 'commentary', labelKey: 'studyTabBar.commentary', iconSvg: CommentOneSmallSvg },
  { id: 'dictionary', labelKey: 'studyTabBar.dictionary', iconSvg: BookOpenSmallSvg },
];

export function StudyTabBar({ activePage, onNavigate }: StudyTabBarProps) {
  const { t } = useTranslation();
  return (
    <div class="study-tab-bar">
      <button
        class="study-tab-bar__tab study-tab-bar__tab--home"
        onClick={() => onNavigate('home')}
        title={t('studyTabBar.home')}
      >
        <i class="fa-solid fa-house" />
      </button>
      {TAB_ITEMS.map((tab) => (
        <button
          key={tab.id}
          class={`study-tab-bar__tab ${activePage === tab.id ? 'study-tab-bar__tab--active' : ''}`}
          onClick={() => onNavigate(tab.id)}
          title={t(tab.labelKey)}
        >
          <span class="study-tab-bar__icon" dangerouslySetInnerHTML={{ __html: tab.iconSvg }} />
          <span class="study-tab-bar__label">{t(tab.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
