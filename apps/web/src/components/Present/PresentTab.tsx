import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../hooks/useStore';
import { presentStore } from '../../stores/presentStore';
import { usePresenter } from './usePresenter';
import { PresentPanelBody } from './PresentPanelBody';
import { PresentPreview } from './PresentPreview';

/**
 * Session mode as a tab, rather than a strip docked under the reader: the
 * desktop Study pane's Present tab, and mobile's root-level Present tab
 * (`compact`, replacing Home in the bottom nav while a session is live).
 *
 * It carries exactly what `PresentBar` (the always-on compact strip mobile
 * keeps visible on every *other* tab) carries at the top -- the viewer count,
 * what is on the wall, send/next/previous/blank -- reusing its
 * `present-bar__*` classes (they are BEM class names, not descendant
 * selectors, so they render identically outside `.present-bar` itself), and
 * then `PresentPanelBody` embedded directly below rather than behind a
 * "panel" toggle, since a whole tab already is that disclosure.
 *
 * The global keyboard shortcuts are not wired up here: `usePresenterShortcuts`
 * is called once from `DesktopApp` (mobile has no keyboard to speak of) so
 * they keep working on the Study tab or any other tab, not only while this
 * one is selected.
 */
export function PresentTab(props: { compact?: boolean }) {
  const { t } = useTranslation();
  const view = usePresenter();
  const { staged, wall } = view;
  const session = useStore(presentStore, () => presentStore.session);
  // Collapsed by default on nothing in particular -- just a plain boolean, not
  // persisted: reopening the tab (or the app) is exactly when a presenter most
  // wants to be reminded what the room is currently seeing.
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

  if (!view.presenting) return null;

  const blanked = wall?.display.blanked ?? false;
  const connected = view.connection === 'live';

  return (
    <div class={`present-tab${props.compact ? ' present-tab--compact' : ''}`}>
      <div class="present-tab__row">
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

      <PresentPanelBody compact={props.compact} previewInline={false} />

      {/*
        The preview lives in its own panel at the bottom of the tab, not
        nested inside the "Screen" section, so the running order (or hymns, or
        the join panel) and a look at what the room is actually seeing are
        both on screen at the same time -- the point of having a preview at
        all. Desktop only: see the note in `PresentPanelBody`.
      */}
      {!props.compact && session && (
        <div class="present-tab__preview">
          <button
            type="button"
            class="present-tab__preview-toggle"
            onClick={() => setPreviewCollapsed(collapsed => !collapsed)}
            aria-expanded={!previewCollapsed}
          >
            <span>{t('present.previewLabel')}</span>
            <i class={`fa-solid ${previewCollapsed ? 'fa-chevron-up' : 'fa-chevron-down'}`} aria-hidden="true" />
          </button>
          {!previewCollapsed && <PresentPreview joinCode={session.joinCode} />}
        </div>
      )}
    </div>
  );
}
