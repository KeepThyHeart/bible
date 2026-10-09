import { useEffect, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { presentStore, type ControllerSession } from '../../stores/presentStore';
import { HandoffSection, JoinSection, ScreenSection } from './sections';

export const SIMPLE_VIEWER_PATH = '/present/solo';

/**
 * The Control pane's hamburger: screen settings, join and share, handoff, the
 * simple viewer, and help. A popover under the status row; a click outside or
 * Escape closes it.
 */
export function ControlMenu(props: {
  session: ControllerSession | null;
  onClose: () => void;
  onOpenHelp: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { session } = props;

  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      // The toggle button closes it itself; don't reopen on the same click.
      if ((target as HTMLElement).closest?.('[data-control-menu-toggle]')) return;
      props.onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [props.onClose]);

  // In a portal: the pane clips its children, which cut the menu and the handoff QR short.
  return createPortal(
    <div class="pz-menu present-panel" ref={ref} role="menu" aria-label={t('present.menu')}>
      <ScreenSection />
      {session && <JoinSection session={session} />}
      {session && <HandoffSection session={session} />}

      <section class="present-panel__menu-section">
        <a class="present-panel__button" href={SIMPLE_VIEWER_PATH} target="_blank" rel="noopener noreferrer" onClick={props.onClose}>
          <i class="fa-solid fa-display" aria-hidden="true" />
          {t('present.control.openSimpleViewer')}
        </a>
        <p class="present-panel__hint">{t('present.control.simpleViewerHint')}</p>
        <button
          type="button"
          class="present-panel__button"
          onClick={() => { props.onClose(); props.onOpenHelp(); }}
        >
          <i class="fa-solid fa-circle-question" aria-hidden="true" />
          {t('present.help')}
        </button>
      </section>

      {session && (
        <section class="present-panel__menu-section">
          <button type="button" class="present-panel__button" onClick={() => { props.onClose(); presentStore.leave(); }}>
            {t('present.leave')}
          </button>
          <p class="present-panel__hint">{t('present.leaveHint')}</p>
        </section>
      )}
    </div>,
    document.body,
  );
}
