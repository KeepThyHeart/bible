import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import type { ControllerSession } from '../../../stores/presentStore';
import { SIMPLE_VIEWER_PATH } from './ControlMenu';
import { JoinSection, ScreenSection } from './sections';

/**
 * First-run setup: one slim banner that never crowds the controls. "Set up
 * screen" opens the Screen and Join sections inline; "Hide setup" folds them
 * again, and the x (or "Done") retires the banner for this device. It also
 * offers the simple viewer, clearly, for people who only mirror a screen and
 * need none of this. Everything in it is also in the hamburger menu.
 */
export function SetupCard(props: { session: ControllerSession | null; onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section class={`pz-setup present-panel ${open ? 'pz-setup--open' : ''}`} aria-label={t('present.control.setupTitle')}>
      <div class="pz-setup__bar">
        <h2 class="pz-setup__title">{t('present.control.setupTitle')}</h2>
        <button type="button" class="pz-btn" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <i class={`fa-solid ${open ? 'fa-chevron-up' : 'fa-sliders'}`} aria-hidden="true" />
          {open ? t('present.control.setupHide') : t('present.control.setupOpen')}
        </button>
        <button
          type="button" class="pz-btn pz-btn--icon" onClick={props.onDone}
          title={t('present.control.setupDone')} aria-label={t('present.control.setupDone')}
        >
          <i class="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>

      {open && (
        <>
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
        </>
      )}
    </section>
  );
}
