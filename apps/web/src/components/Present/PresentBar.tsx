import { useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { presentStore } from '../../stores/presentStore';
import { usePresenter } from './usePresenter';
import { PresentPanel } from './PresentPanel';

/**
 * The control strip: what a presenter touches while presenting.
 *
 * It is docked to the bottom of the reading app and it is deliberately short.
 * Everything on it is something that might be needed *mid-sentence*, in a room,
 * without looking down. Anything that can wait -- the running order, the join
 * code, display settings -- lives in the panel behind the last button.
 *
 * Three things earn their place by being needed urgently:
 *
 *  - **Blank.** During prayer, during an unplanned digression, or when
 *    something has gone wrong on the screen. It is the largest control and it
 *    is always in the same place, because it is the one that gets pressed
 *    without looking.
 *  - **Send.** The line between what the presenter is reading and what the room
 *    can see. It says what it would send, and it looks different when the wall
 *    is already showing it, so there is never a question of which.
 *  - **Next / previous.** Sized for a thumb on a phone held low.
 *
 * The viewer count is the quiet one that matters most before a service starts:
 * it is how a presenter confirms the television is actually connected, minutes
 * before it would be embarrassing to find out otherwise.
 */

/** Keys held down mid-service must not reach the reader underneath. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function PresentBar(props: { compact?: boolean }) {
  const { t } = useTranslation();
  const view = usePresenter();
  const { staged, wall } = view;

  /**
   * Every shortcut carries a modifier, without exception.
   *
   * A bare arrow key belongs to the reader, and quietly repurposing one the
   * moment a session starts would change what the app does under someone in the
   * middle of using it. Alt+Enter and Ctrl+Enter follow the prior art.
   */
  useEffect(() => {
    if (!view.presenting) return;

    const onKey = (event: KeyboardEvent): void => {
      if (isTyping(event.target) || event.repeat) return;

      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        void presentStore.toggleBlank();
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey) return;

      if (event.key === 'Enter' && staged) {
        event.preventDefault();
        void presentStore.show(staged.item, staged.index);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        void presentStore.step('next');
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void presentStore.step('previous');
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.presenting, staged?.item.book, staged?.item.chapter, staged?.index]);

  if (!view.presenting) return null;

  const blanked = wall?.display.blanked ?? false;
  const connected = view.connection === 'live';

  return (
    <>
      {view.panelOpen && <PresentPanel compact={props.compact} />}
      <div class={`present-bar${props.compact ? ' present-bar--compact' : ''}`} role="region" aria-label={t('present.barLabel')}>
        <div class="present-bar__status">
          <span
            class={`present-bar__viewers ${connected ? '' : 'present-bar__viewers--offline'}`}
            title={connected ? t('present.viewersTooltip') : t('present.reconnecting')}
          >
            <i class="fa-solid fa-tv" aria-hidden="true" />
            {view.viewers}
          </span>
          <span class="present-bar__live">
            {view.liveLabel
              ? <><span class="present-bar__live-label">{t('present.onScreen')}</span> {view.liveLabel}</>
              : <span class="present-bar__live-empty">{t('present.nothingOnScreen')}</span>}
          </span>
        </div>

        <button
          type="button"
          class={`present-bar__send ${view.stagedIsLive ? 'present-bar__send--live' : ''}`}
          disabled={!staged || view.stagedIsLive}
          onClick={() => staged && void presentStore.show(staged.item, staged.index)}
          title={t('present.sendTooltip')}
        >
          <i class={`fa-solid ${view.stagedIsLive ? 'fa-check' : 'fa-arrow-up'}`} aria-hidden="true" />
          <span class="present-bar__send-text">
            {staged
              ? (view.stagedIsLive ? t('present.showing', { ref: staged.label }) : t('present.send', { ref: staged.label }))
              : t('present.nothingToSend')}
          </span>
        </button>

        <div class="present-bar__controls">
          <button
            type="button"
            class="present-bar__btn"
            onClick={() => void presentStore.step('previous')}
            disabled={!wall?.live}
            title={t('present.previous')}
            aria-label={t('present.previous')}
          >
            <i class="fa-solid fa-chevron-left" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="present-bar__btn"
            onClick={() => void presentStore.step('next')}
            disabled={!wall?.live}
            title={t('present.next')}
            aria-label={t('present.next')}
          >
            <i class="fa-solid fa-chevron-right" aria-hidden="true" />
          </button>
          <button
            type="button"
            class={`present-bar__btn present-bar__btn--blank ${blanked ? 'present-bar__btn--on' : ''}`}
            onClick={() => void presentStore.toggleBlank()}
            title={blanked ? t('present.unblank') : t('present.blank')}
            aria-pressed={blanked}
          >
            <i class={`fa-solid ${blanked ? 'fa-eye' : 'fa-eye-slash'}`} aria-hidden="true" />
            <span class="present-bar__btn-text">
              {blanked ? t('present.unblank') : t('present.blank')}
            </span>
          </button>
          <button
            type="button"
            class={`present-bar__btn ${view.panelOpen ? 'present-bar__btn--on' : ''}`}
            onClick={() => presentStore.setPanelOpen(!view.panelOpen)}
            title={t('present.panel')}
            aria-expanded={view.panelOpen}
          >
            <i class="fa-solid fa-list-ol" aria-hidden="true" />
          </button>
        </div>
      </div>

      {view.error && (
        <div class="present-bar__error" role="status">
          {view.error}
          <button type="button" onClick={() => presentStore.clearError()} aria-label={t('common.close')}>
            <i class="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
