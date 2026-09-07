import { useEffect, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { API_BASE } from '../../utils/apiUrl';

interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Opens the feedback dialog. Omitted where no feedback surface is wired up. */
  onSendFeedback?: () => void;
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export function HelpDialog({ isOpen, onClose, onSendFeedback }: HelpDialogProps) {
  const { t } = useTranslation(['help', 'ui']);
  const isMobile = useIsMobile();
  const [docsUrl, setDocsUrl] = useState('');

  // The documentation site is deployment-specific, so it comes from
  // /api/config rather than the bundle. Fetched once, on first open — a config
  // that omits docsUrl simply leaves the state empty and nothing renders.
  useEffect(() => {
    if (!isOpen || docsUrl) return;
    fetch(`${API_BASE}/api/config`)
      .then(r => r.json())
      .then(data => { if (typeof data?.docsUrl === 'string' && data.docsUrl) setDocsUrl(data.docsUrl); })
      .catch(() => {});
  }, [isOpen]);

  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div class="settings-panel-overlay" onClick={onClose}>
      <div class="help-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="help-dialog__header">
          <h3><i class="fa-solid fa-circle-question" style={{ marginRight: '8px', opacity: 0.5 }} />{t('title')}</h3>
          <button class="help-dialog__close" onClick={onClose}>
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
        <div class="help-dialog__body">

          {(docsUrl || onSendFeedback) && (
            <div class="help-dialog__links">
              {docsUrl && (
                <a
                  class="help-dialog__link-card help-dialog__link-card--primary"
                  href={docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="help-docs-link"
                >
                  <i class="fa-solid fa-book-open help-dialog__link-icon" />
                  <span class="help-dialog__link-text">
                    <strong>{t('docs.cta')}</strong>
                    <small>{t('docs.desc')}</small>
                  </span>
                  <i class="fa-solid fa-arrow-up-right-from-square fa-xs help-dialog__link-chevron" />
                </a>
              )}
              {onSendFeedback && (
                <button
                  type="button"
                  class="help-dialog__link-card"
                  onClick={onSendFeedback}
                  data-testid="help-feedback-btn"
                >
                  <i class="fa-solid fa-comment-dots help-dialog__link-icon" />
                  <span class="help-dialog__link-text">
                    <strong>{t('feedback.cta')}</strong>
                    <small>{t('feedback.desc')}</small>
                  </span>
                </button>
              )}
            </div>
          )}

          <section class="help-dialog__section">
            <h4>{t('gettingStarted.title')}</h4>
            <p>
              {t('gettingStarted.intro', { context: isMobile ? t('gettingStarted.introContext.mobile') : t('gettingStarted.introContext.desktop') })}
            </p>
            <ul>
              <li dangerouslySetInnerHTML={{ __html: t('gettingStarted.referenceHint') }} />
              <li>{t('gettingStarted.searchHint')}</li>
              {!isMobile && (
                <li dangerouslySetInnerHTML={{ __html: t('gettingStarted.searchTypeHint') }} />
              )}
              {isMobile && (
                <li dangerouslySetInnerHTML={{ __html: t('gettingStarted.searchTypeHintMobile') }} />
              )}
            </ul>
          </section>

          <section class="help-dialog__section">
            <h4>{isMobile ? t('readingMobile.title') : t('biblePaneDesktop.title')}</h4>
            <ul>
              <li>{isMobile ? t('readingMobile.compareTabs') : t('biblePaneDesktop.compareTabs')}</li>
              <li dangerouslySetInnerHTML={{ __html: isMobile ? t('readingMobile.translationSelector') : t('biblePaneDesktop.translationSelector') }} />
              <li dangerouslySetInnerHTML={{ __html: isMobile ? t('readingMobile.displayModes') : t('biblePaneDesktop.displayModes') }} />
              {!isMobile && (
                <>
                  <li dangerouslySetInnerHTML={{ __html: t('biblePaneDesktop.strongsClick') }} />
                  <li dangerouslySetInnerHTML={{ __html: t('biblePaneDesktop.copyDialog') }} />
                </>
              )}
              {isMobile && (
                <li dangerouslySetInnerHTML={{ __html: t('readingMobile.longPress') }} />
              )}
            </ul>
          </section>

          {isMobile ? (
            <section class="help-dialog__section">
              <h4>{t('navigation.title')}</h4>
              <ul>
                <li dangerouslySetInnerHTML={{ __html: t('navigation.bottomTabs') }} />
                <li dangerouslySetInnerHTML={{ __html: t('navigation.studyTab') }} />
                <li dangerouslySetInnerHTML={{ __html: t('navigation.commentaryTab') }} />
              </ul>
            </section>
          ) : (
            <section class="help-dialog__section">
              <h4>{t('commentaryAndSearch.title')}</h4>
              <ul>
                <li dangerouslySetInnerHTML={{ __html: t('commentaryAndSearch.rightPane') }} />
                <li>{t('commentaryAndSearch.switchPanes')}</li>
                <li dangerouslySetInnerHTML={{ __html: t('commentaryAndSearch.ctrlClick') }} />
              </ul>
            </section>
          )}

          {!isMobile && (
            <section class="help-dialog__section">
              <h4>{t('shortcuts.title')}</h4>
              <table class="help-dialog__shortcuts">
                <tbody>
                  <tr><td><kbd>Ctrl+K</kbd></td><td>{t('shortcuts.focusSearch')}</td></tr>
                  <tr><td><kbd>/</kbd></td><td>{t('shortcuts.focusSearchAlt')}</td></tr>
                  <tr><td><kbd>Ctrl+C</kbd></td><td>{t('shortcuts.copyDialog')}</td></tr>
                  <tr><td><kbd>{t('helpDialog.esc')}</kbd></td><td>{t('shortcuts.closeDialog')}</td></tr>
                </tbody>
              </table>
            </section>
          )}

          <section class="help-dialog__section">
            <h4>{t('settings.title')}</h4>
            <p>
              {isMobile
                ? t('settings.descMobile')
                : <>{t('settings.descDesktop')}</>
              }
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
