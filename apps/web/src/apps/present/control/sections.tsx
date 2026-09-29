import { useEffect, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../../hooks/useStore';
import { presentStore, type ControllerSession } from '../../../stores/presentStore';
import { API_BASE } from '../../../utils/apiUrl';
import { buildControlLink, buildViewerLink, typedWatchAddress } from '../../../present/controlLink';
import { MAX_FONT_STEP, MIN_FONT_STEP } from '../../../present/protocol';
import { presenterSend, usePresenterState } from '../presenterSink';

/**
 * The settings sections shared by the hamburger menu and the first-run setup
 * card: Screen (theme, text size, clicker keys), Join and share, and Hand off.
 * Carried over from the old `PresentPanelBody`, with its `present-panel__*`
 * classes (they live in styles/_present.scss).
 */

function useCopy() {
  const [copied, setCopied] = useState<'viewer' | 'control' | null>(null);
  const copy = async (text: string, which: 'viewer' | 'control'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // No clipboard permission. The link is on screen and selectable.
    }
  };
  return { copied, copy };
}

/**
 * The handoff link as something a phone can photograph. Drawn here rather than
 * fetched: the server keeps only a hash of the control token, so it cannot build
 * this link, which is a property worth keeping. The encoder is imported on
 * demand, and the SVG is our own output with no interpolated input.
 */
function HandoffQr(props: { link: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import('../../../present/qr')
      .then(({ qrSvg }) => { if (live) setSvg(qrSvg(props.link)); })
      .catch(() => { /* The link below it is the fallback, and is always there. */ });
    return () => { live = false; };
  }, [props.link]);
  if (!svg) return null;
  return <div class="present-panel__qr present-panel__qr--small" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function ScreenSection() {
  const { t } = useTranslation();
  const state = usePresenterState();
  const acceptClickerKeys = useStore(presentStore, () => presentStore.acceptClickerKeys);
  const fontStep = state?.display.fontStep ?? 5;
  const setFont = (step: number): void => {
    presenterSend({
      type: 'setFontStep',
      fontStep: Math.max(MIN_FONT_STEP, Math.min(MAX_FONT_STEP, step)),
    });
  };

  return (
    <section class="present-panel__menu-section">
      <h2 class="present-panel__menu-heading">{t('present.screen')}</h2>

      <div class="present-panel__row">
        <span class="present-panel__row-label">{t('present.textSize')}</span>
        <button
          type="button" class="present-panel__step"
          onClick={() => setFont(fontStep - 1)}
          disabled={fontStep <= MIN_FONT_STEP}
          aria-label={t('present.textSmaller')}
        >
          <i class="fa-solid fa-minus" aria-hidden="true" />
        </button>
        <span class="present-panel__step-value">{fontStep}</span>
        <button
          type="button" class="present-panel__step"
          onClick={() => setFont(fontStep + 1)}
          disabled={fontStep >= MAX_FONT_STEP}
          aria-label={t('present.textLarger')}
        >
          <i class="fa-solid fa-plus" aria-hidden="true" />
        </button>
      </div>

      <div class="present-panel__row">
        <span class="present-panel__row-label">{t('present.theme')}</span>
        {(['light', 'dark', 'max'] as const).map(theme => (
          <button
            key={theme}
            type="button"
            class={`present-panel__choice ${state?.display.theme === theme ? 'present-panel__choice--active' : ''}`}
            onClick={() => presenterSend({ type: 'setTheme', theme })}
          >
            {theme === 'max' ? t('present.themeMax') : theme === 'dark' ? t('present.themeDark') : t('present.themeLight')}
          </button>
        ))}
      </div>

      <label class="present-panel__toggle">
        <input
          type="checkbox"
          checked={acceptClickerKeys}
          onChange={event => presentStore.setAcceptClickerKeys((event.target as HTMLInputElement).checked)}
        />
        {t('present.acceptClickerKeys')}
      </label>
      <p class="present-panel__hint">{t('present.acceptClickerKeysHint')}</p>
    </section>
  );
}

export function JoinSection(props: { session: ControllerSession }) {
  const { t } = useTranslation();
  const state = usePresenterState();
  const { copied, copy } = useCopy();
  const { session } = props;

  return (
    <section class="present-panel__menu-section">
      <h2 class="present-panel__menu-heading">{t('present.joining')}</h2>
      <img
        class="present-panel__qr"
        src={`${API_BASE}/api/present/j/${encodeURIComponent(session.joinCode)}/qr.svg`}
        alt={t('present.qrAlt', { code: session.joinCode })}
      />
      <div class="present-panel__join-detail">
        <p class="present-panel__code">{session.joinCode}</p>
        <p class="present-panel__link">{buildViewerLink(session.joinCode)}</p>
        <p class="present-panel__hint present-panel__typed-hint">
          {t('present.joinTypedHint')} <strong>{typedWatchAddress()}</strong>
        </p>
        <div class="present-panel__join-actions">
          <a
            class="present-panel__button"
            href={buildViewerLink(session.joinCode)}
            target="_blank"
            rel="noopener"
          >
            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
            {t('present.openViewer')}
          </a>
          <button
            type="button"
            class="present-panel__button"
            onClick={() => void copy(buildViewerLink(session.joinCode), 'viewer')}
          >
            <i class="fa-solid fa-copy" aria-hidden="true" />
            {copied === 'viewer' ? t('present.copied') : t('present.copyLink')}
          </button>
        </div>

        <label class="present-panel__toggle">
          <input
            type="checkbox"
            checked={state?.session.joinsLocked ?? false}
            onChange={event => void presentStore.send({
              type: 'lockJoins',
              locked: (event.target as HTMLInputElement).checked,
            })}
          />
          {t('present.lockJoins')}
        </label>
        <p class="present-panel__hint">{t('present.lockJoinsHint')}</p>
      </div>
    </section>
  );
}

/**
 * Moving control to another device is what makes preparing on a desktop and
 * presenting from a phone work. It is also the one link that grants control, so
 * it stays behind a deliberate click and says plainly what it does.
 */
export function HandoffSection(props: { session: ControllerSession }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  const [show, setShow] = useState(false);
  const link = buildControlLink(props.session);

  return (
    <section class="present-panel__menu-section">
      {show ? (
        <div class="present-panel__handoff">
          <p class="present-panel__warning">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true" />
            {t('present.handoffWarning')}
          </p>
          <HandoffQr link={link} />
          <code class="present-panel__handoff-link">{link}</code>
          <button type="button" class="present-panel__button" onClick={() => void copy(link, 'control')}>
            <i class="fa-solid fa-copy" aria-hidden="true" />
            {copied === 'control' ? t('present.copied') : t('present.copyControlLink')}
          </button>
        </div>
      ) : (
        <button type="button" class="present-panel__button" onClick={() => setShow(true)}>
          <i class="fa-solid fa-mobile-screen" aria-hidden="true" />
          {t('present.handoff')}
        </button>
      )}
    </section>
  );
}
