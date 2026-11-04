import { useTranslation } from 'react-i18next';
import { focusSearchField } from '../../utils/focusSearchField';

/**
 * First stops in the tab order: jump past the app rail and header to the reading
 * area or to the search box. Buttons rather than `#fragment` links because the
 * URL hash is the router.
 */
export function SkipLinks() {
  const { t } = useTranslation();
  const toMain = (e: Event) => {
    e.preventDefault();
    const main = document.getElementById('main-content');
    if (main) { main.focus(); main.scrollIntoView?.({ block: 'start' }); }
  };
  const toSearch = (e: Event) => {
    e.preventDefault();
    focusSearchField();
  };
  return (
    <div class="skip-links">
      <a class="skip-links__link" href="#main-content" onClick={toMain}>
        {t('a11y.skipToContent', 'Skip to content')}
      </a>
      <a class="skip-links__link" href="#search" onClick={toSearch}>
        {t('a11y.skipToSearch', 'Skip to search')}
      </a>
    </div>
  );
}
