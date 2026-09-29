import { useTranslation } from 'react-i18next';
import type { ControllerSession } from '../../../stores/presentStore';
import { SIMPLE_VIEWER_PATH } from './ControlMenu';
import { JoinSection, ScreenSection } from './sections';

/**
 * First-run setup: the Screen and Join sections inline, so a new presenter
 * sees them without hunting through the hamburger. It stays until they say
 * they are done (once per device). It also offers the simple viewer, clearly,
 * for people who only mirror a screen and need none of this.
 */
export function SetupCard(props: { session: ControllerSession | null; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <section class="pz-setup present-panel" aria-label={t('present.control.setupTitle')}>
      <h2 class="pz-setup__title">{t('present.control.setupTitle')}</h2>

      <div class="pz-setup__simple">
        <p>{t('present.control.simpleViewerOffer')}</p>
        <a class="pz-btn" href={SIMPLE_VIEWER_PATH} target="_blank" rel="noopener">
          <i class="fa-solid fa-display" aria-hidden="true" />
          {t('present.control.openSimpleViewer')}
        </a>
      </div>

      <ScreenSection />
      {props.session ? (
        <JoinSection session={props.session} />
      ) : (
        <p class="pz-hint">{t('present.control.setupGoLive')}</p>
      )}

      <button type="button" class="pz-btn pz-setup__done" onClick={props.onDone}>
        {t('present.control.setupDone')}
      </button>
    </section>
  );
}
