import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../../hooks/useEscapeKey';

/**
 * A concise, multi-tab help overlay for presenting, opened from the hamburger
 * menu (`PresentPanelBody.tsx`) rather than folded into the app's own
 * `HelpDialog`: presenting has its own vocabulary (staged vs. sent, the
 * running order, handoff) that would otherwise crowd a dialog about reading
 * and searching Scripture.
 *
 * Word/phrase highlighting has no tab here yet: the sending-to-screen
 * interaction for it is still a design choice pending the human's answer (see
 * the task thread), and documenting a gesture that does not exist yet would
 * only confuse. Add a tab for it once a direction is implemented.
 *
 * Reuses `.help-dialog` and `.settings-panel-overlay` from the app's own help
 * dialog rather than a bespoke box, so this reads as the same kind of thing
 * to a presenter who has already opened the other one.
 */

type HelpTab = 'sending' | 'hymnsQuotes' | 'joining';

const TABS: HelpTab[] = ['sending', 'hymnsQuotes', 'joining'];

export function PresentHelp(props: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation('help');
  const [tab, setTab] = useState<HelpTab>('sending');
  useEscapeKey(props.isOpen, props.onClose);

  if (!props.isOpen) return null;

  return (
    <div class="settings-panel-overlay" onClick={props.onClose}>
      <div class="help-dialog" onClick={event => event.stopPropagation()}>
        <div class="help-dialog__header">
          <h3>
            <i class="fa-solid fa-circle-question" style={{ marginRight: '8px', opacity: 0.5 }} aria-hidden="true" />
            {t('present.title')}
          </h3>
          <button type="button" class="help-dialog__close" onClick={props.onClose} aria-label={t('present.close')}>
            <i class="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div class="help-dialog__tabs">
          {TABS.map(id => (
            <button
              key={id}
              type="button"
              class={`help-dialog__tab ${tab === id ? 'help-dialog__tab--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {t(`present.tab${id === 'sending' ? 'Sending' : id === 'hymnsQuotes' ? 'HymnsQuotes' : 'Joining'}`)}
            </button>
          ))}
        </div>

        <div class="help-dialog__body">
          {tab === 'sending' && (
            <section class="help-dialog__section">
              <h4>{t('present.sending.title')}</h4>
              <ul>
                <li dangerouslySetInnerHTML={{ __html: t('present.sending.stage') }} />
                <li dangerouslySetInnerHTML={{ __html: t('present.sending.sendShortcut') }} />
                <li dangerouslySetInnerHTML={{ __html: t('present.sending.studyArrows') }} />
                <li dangerouslySetInnerHTML={{ __html: t('present.sending.blank') }} />
              </ul>
            </section>
          )}
          {tab === 'hymnsQuotes' && (
            <section class="help-dialog__section">
              <h4>{t('present.hymnsQuotes.title')}</h4>
              <ul>
                <li dangerouslySetInnerHTML={{ __html: t('present.hymnsQuotes.search') }} />
                <li dangerouslySetInnerHTML={{ __html: t('present.hymnsQuotes.quote') }} />
                <li dangerouslySetInnerHTML={{ __html: t('present.hymnsQuotes.plan') }} />
              </ul>
            </section>
          )}
          {tab === 'joining' && (
            <section class="help-dialog__section">
              <h4>{t('present.joining.title')}</h4>
              <ul>
                <li dangerouslySetInnerHTML={{ __html: t('present.joining.share') }} />
                <li dangerouslySetInnerHTML={{ __html: t('present.joining.handoff') }} />
                <li dangerouslySetInnerHTML={{ __html: t('present.joining.lock') }} />
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
