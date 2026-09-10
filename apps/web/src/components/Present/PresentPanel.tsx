import { useEffect, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../hooks/useStore';
import { presentStore } from '../../stores/presentStore';
import { API_BASE } from '../../utils/apiUrl';
import { buildControlLink, buildViewerLink } from '../../present/controlLink';
import { MAX_FONT_STEP, MIN_FONT_STEP } from '../../present/protocol';
import { PresentHymns } from './PresentHymns';
import { PresentPlanList } from './PresentPlanList';
import { PresentPreview } from './PresentPreview';
import { usePresenter } from './usePresenter';

/**
 * Everything a presenter needs but not mid-sentence.
 *
 * The split between this and the control strip is the whole layout decision:
 * the strip holds what might be wanted while speaking, and this holds
 * everything else. Putting the running order or the font controls on the strip
 * would push blank and next further from a thumb, which is the wrong trade in
 * the moment that matters.
 */

type Section = 'plan' | 'hymns' | 'screen' | 'join';

/**
 * The handoff link as something a phone can photograph.
 *
 * Drawn here rather than fetched from the server, and it has to be: the server
 * stores only a hash of the control token, so it *cannot* build this link. That
 * is a property worth keeping, not an inconvenience to work around -- a copy of
 * the database hands over no live sessions.
 *
 * The encoder is imported on demand so it costs the reading app nothing until
 * someone actually opens this panel. The SVG is our own output from our own
 * code with no interpolated input, which is what makes setting it as markup
 * safe here.
 */
function HandoffQr(props: { link: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void import('../../present/qr')
      .then(({ qrSvg }) => { if (live) setSvg(qrSvg(props.link)); })
      .catch(() => { /* The link below it is the fallback, and is always there. */ });
    return () => { live = false; };
  }, [props.link]);

  if (!svg) return null;
  return (
    <div
      class="present-panel__qr present-panel__qr--small"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function PresentPanel(props: { compact?: boolean }) {
  const { t } = useTranslation();
  const view = usePresenter();
  const session = useStore(presentStore, () => presentStore.session);
  const plan = useStore(presentStore, () => presentStore.plan);

  // A session with nothing on the wall and nothing planned has just been
  // created, and the first thing its presenter needs is the join code.
  const [section, setSection] = useState<Section>(
    () => (!view.wall?.live && plan.length === 0 ? 'join' : 'plan'),
  );
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [copied, setCopied] = useState<'viewer' | 'control' | null>(null);

  if (!session) return null;

  const copy = async (text: string, which: 'viewer' | 'control'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // No clipboard permission. The link is on screen and selectable.
    }
  };

  const fontStep = view.wall?.display.fontStep ?? 5;
  const setFont = (step: number): void => {
    void presentStore.send({
      type: 'setFontStep',
      fontStep: Math.max(MIN_FONT_STEP, Math.min(MAX_FONT_STEP, step)),
    });
  };

  const tab = (id: Section, label: string) => (
    <button
      type="button"
      class={`present-panel__tab ${section === id ? 'present-panel__tab--active' : ''}`}
      onClick={() => setSection(id)}
    >
      {label}
    </button>
  );

  return (
    <div class="present-panel">
      <div class="present-panel__tabs">
        {tab('plan', t('present.runningOrder'))}
        {tab('hymns', t('present.hymns'))}
        {tab('screen', t('present.screen'))}
        {tab('join', t('present.joining'))}
        <button
          type="button"
          class="present-panel__close"
          onClick={() => presentStore.setPanelOpen(false)}
          aria-label={t('common.close')}
        >
          <i class="fa-solid fa-chevron-down" aria-hidden="true" />
        </button>
      </div>

      <div class="present-panel__body">
        {section === 'plan' && <PresentPlanList />}

        {section === 'hymns' && <PresentHymns />}

        {section === 'screen' && (
          <div class="present-panel__screen">
            {/*
              A preview on a phone would be a postage stamp competing for the
              only screen the presenter has. On a phone the actual television is
              usually in the room anyway.
            */}
            {props.compact
              ? <p class="present-panel__note">{t('present.previewDesktopOnly')}</p>
              : <PresentPreview joinCode={session.joinCode} />}

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
              {(['dark', 'light'] as const).map(theme => (
                <button
                  key={theme}
                  type="button"
                  class={`present-panel__choice ${view.wall?.display.theme === theme ? 'present-panel__choice--active' : ''}`}
                  onClick={() => void presentStore.send({ type: 'setTheme', theme })}
                >
                  {theme === 'dark' ? t('present.themeDark') : t('present.themeLight')}
                </button>
              ))}
            </div>
          </div>
        )}

        {section === 'join' && (
          <div class="present-panel__join">
            {/*
              The same code the lobby screen shows. It is here as well because
              the presenter is often asked for it directly, and because once a
              passage is up the wall no longer carries it.
            */}
            <img
              class="present-panel__qr"
              src={`${API_BASE}/api/present/j/${encodeURIComponent(session.joinCode)}/qr.svg`}
              alt={t('present.qrAlt', { code: session.joinCode })}
            />
            <div class="present-panel__join-detail">
              <p class="present-panel__code">{session.joinCode}</p>
              <p class="present-panel__link">{buildViewerLink(session.joinCode)}</p>
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
                  checked={view.wall?.session.joinsLocked ?? false}
                  onChange={event => void presentStore.send({
                    type: 'lockJoins',
                    locked: (event.target as HTMLInputElement).checked,
                  })}
                />
                {t('present.lockJoins')}
              </label>
              <p class="present-panel__hint">{t('present.lockJoinsHint')}</p>
            </div>

            <div class="present-panel__danger">
              {/*
                Moving control to another device is what makes preparing on a
                desktop and presenting from a phone work. It is also the one
                link that grants control, so it stays behind a deliberate click
                and says plainly what it does -- and never goes near the wall.
              */}
              {showHandoff ? (
                <div class="present-panel__handoff">
                  <p class="present-panel__warning">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                    {t('present.handoffWarning')}
                  </p>
                  <HandoffQr link={buildControlLink(session)} />
                  <code class="present-panel__handoff-link">{buildControlLink(session)}</code>
                  <button
                    type="button"
                    class="present-panel__button"
                    onClick={() => void copy(buildControlLink(session), 'control')}
                  >
                    <i class="fa-solid fa-copy" aria-hidden="true" />
                    {copied === 'control' ? t('present.copied') : t('present.copyControlLink')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  class="present-panel__button"
                  onClick={() => setShowHandoff(true)}
                >
                  <i class="fa-solid fa-mobile-screen" aria-hidden="true" />
                  {t('present.handoff')}
                </button>
              )}

              {confirmEnd ? (
                <div class="present-panel__confirm">
                  <span>{t('present.endConfirm')}</span>
                  <button
                    type="button"
                    class="present-panel__button present-panel__button--danger"
                    onClick={() => void presentStore.end()}
                  >
                    {t('present.endYes')}
                  </button>
                  <button type="button" class="present-panel__button" onClick={() => setConfirmEnd(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <div class="present-panel__join-actions">
                  <button type="button" class="present-panel__button" onClick={() => presentStore.leave()}>
                    {t('present.leave')}
                  </button>
                  <button
                    type="button"
                    class="present-panel__button present-panel__button--danger"
                    onClick={() => setConfirmEnd(true)}
                  >
                    {t('present.end')}
                  </button>
                </div>
              )}
              <p class="present-panel__hint">{t('present.leaveHint')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
