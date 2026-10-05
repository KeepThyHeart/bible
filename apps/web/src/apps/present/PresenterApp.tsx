import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../hooks/useStore';
import { presentStore } from '../../stores/presentStore';
import { presenterIsLive, presenterSend, presenterToggleBlank, usePresenterState } from './presenterSink';
import { clearWallHighlights, revealNextHighlight } from './control/HighlightChips';
import { planTarget, resolvePresenterKey } from './control/presenterKeys';
import { PresentHelp } from '../../components/Present/PresentHelp';
import { PresentPreview } from '../../components/Present/PresentPreview';
import { isTyping } from '../../components/Present/usePresenterShortcuts';
import { describeItem, usePresenter } from '../../components/Present/usePresenter';
import { useCommandHotkey } from '../../present/command';
import type { PresentItem, PresentState } from '../../present/protocol';
import { ControlPane } from './control/ControlPane';
import {
  controlFractionFromDrag, EMPTY_PREFS, fit16x9, layoutForWidth, loadPrefs, notesFractionFor,
  notesFractionFromDrag, rightRows, savePrefs, type LayoutPrefs,
} from './layoutPrefs';
import { NotesPane } from './notes/NotesPane';
import { notesStore } from './notes/notesStore';
import { ServiceMenu } from './notes/services/ServiceMenu';
import { PhoneLayout } from './PhoneLayout';
import { backToStudy, isAppActive } from '../../host/appHost';
import { useIsActiveApp } from '../../host/useIsActiveApp';
import { Splitter } from './Splitter';
import './PresenterApp.css';

const SPLITTER_PX = 6;
const NUDGE = 0.02;

/**
 * The Presenter: a full page under a slim app bar, the app host's `present` app
 * (`#/@present`). Notes fill the
 * left column; Control and Preview share the right, with both splitters
 * draggable and remembered per device. It takes no props and reads only its own
 * stores, so moving it into the app host later is a registration.
 *
 * Plug-in points for the next parts:
 *  - `NotesPane` (notes/NotesPane.tsx) is the whole Notes column.
 *  - `CommandArea` (control/CommandArea.tsx) is the command box and search results at the top of Control.
 *  - `onAddToNotes` below is what the pickers and search results call; it inserts into `notesStore`.
 */
export function PresenterApp() {
  const { t } = useTranslation();
  const view = usePresenter();
  const presenterState = usePresenterState();
  const session = useStore(presentStore, () => presentStore.session);

  const [width, setWidth] = useState(() => window.innerWidth);
  const [prefs, setPrefs] = useState<LayoutPrefs>(loadPrefs);
  const [helpOpen, setHelpOpen] = useState(false);
  const [barMenuOpen, setBarMenuOpen] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const gridRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [right, setRight] = useState({ w: 0, h: 0 });

  // Re-render when the notes' current service changes (the app bar shows its menu).
  const [, setNotesTick] = useState(0);
  useEffect(() => notesStore.subscribe(() => setNotesTick(n => n + 1)), []);
  // Kept alive behind Study: its global keys (and the `?` help) belong to the active app only.
  const active = useIsActiveApp('present');
  useCommandHotkey({ enabled: active });

  // The pickers and command search results call this to put an item into the notes.
  const onAddToNotes = (item: PresentItem, label?: string): void => {
    notesStore.addItem(item, label ?? describeItem(item, 0) ?? t('present.untitledItem'));
  };

  const layout = layoutForWidth(width);

  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The Presenter's keys (see `presenterKeys.ts`): `?` help, `H` / `X` note
  // highlights, `N` / `Shift+N` plan items, and before going live the clicker
  // keys against the local session. None fire while typing (the notes editor,
  // the command box, the pickers). Once live, the headless `PresenterKeys`
  // (mounted by the app shell) answers the clicker keys.
  const stateRef = useRef<PresentState | null>(null);
  stateRef.current = presenterState;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isAppActive('present') || isTyping(event.target) || event.defaultPrevented) return;
      const action = resolvePresenterKey(event, {
        live: presenterIsLive(),
        acceptClickerKeys: presentStore.acceptClickerKeys,
        hasLive: Boolean(stateRef.current?.live),
      });
      if (!action) return;
      event.preventDefault();
      switch (action.type) {
        case 'help': setHelpOpen(true); break;
        case 'revealHighlight': revealNextHighlight(); break;
        case 'clearHighlights': clearWallHighlights(); break;
        case 'planItem': {
          const id = planTarget(notesStore.planItems.filter(p => p.item).map(p => p.id), notesStore.livePlanItemId, action.direction);
          if (id) notesStore.showPlanItem(id);
          break;
        }
        case 'step': presenterSend({ type: action.direction }); break;
        case 'toggleBlank': presenterToggleBlank(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The right column's size drives the Control / Preview rows.
  useEffect(() => {
    const el = rightRef.current;
    if (!el) return;
    const measure = (): void => setRight({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout === 'phone']);

  const update = (next: LayoutPrefs, persist: boolean): void => {
    setPrefs(next);
    prefsRef.current = next;
    if (persist) savePrefs(next);
  };

  const dragColumns = (clientX: number): void => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    update({ ...prefsRef.current, notesFraction: notesFractionFromDrag(clientX - rect.left, rect.width) }, false);
  };
  const dragRows = (_x: number, clientY: number): void => {
    const rect = rightRef.current?.getBoundingClientRect();
    if (!rect) return;
    update({ ...prefsRef.current, controlFraction: controlFractionFromDrag(clientY - rect.top, rect.height) }, false);
  };
  const nudgeColumns = (direction: -1 | 1): void => {
    const current = notesFractionFor(width, prefsRef.current);
    update({ ...prefsRef.current, notesFraction: notesFractionFromDrag((current + direction * NUDGE) * 1000, 1000) }, true);
  };
  const nudgeRows = (direction: -1 | 1): void => {
    const rows = rightRows(right.w, right.h - SPLITTER_PX, prefsRef.current.controlFraction);
    const fraction = rows.controlHeight / Math.max(1, right.h - SPLITTER_PX);
    update({ ...prefsRef.current, controlFraction: controlFractionFromDrag((fraction + direction * NUDGE) * 1000, 1000) }, true);
  };

  const rows = rightRows(right.w, right.h - SPLITTER_PX, prefs.controlFraction);
  const screen = fit16x9(right.w, rows.previewHeight);
  const notesFraction = notesFractionFor(width, prefs);
  const connected = view.connection === 'live';

  return (
    <div class="presenter-app" data-layout={layout}>
      <header class="pz-appbar">
        <button type="button" class="pz-appbar__back" onClick={() => { void backToStudy(); }} title={t('present.app.backTitle')}>
          <i class="fa-solid fa-chevron-left" aria-hidden="true" />
          {t('present.app.back')}
        </button>
        <ServiceMenu
          currentId={notesStore.currentServiceId}
          onSelect={s => void notesStore.openService(s.id)}
          onDeleted={id => void notesStore.onServiceDeleted(id)}
        />
        <span class="pz-appbar__spacer" />
        {/* On desktop the Control pane shows the live status; the phone has no such row. */}
        {layout === 'phone' && (
          <span class={`pz-appbar__live ${session ? 'pz-appbar__live--on' : ''}`}>
            {session
              ? <>
                <span class="pz-status__dot" aria-hidden="true" />
                {t('present.app.live')} · <i class="fa-solid fa-tv" aria-hidden="true" /> {connected ? view.viewers : '…'}
              </>
              : t('present.app.notLive')}
          </span>
        )}
        <button
          type="button" class="pz-btn pz-btn--icon" onClick={() => setHelpOpen(true)}
          title={t('present.help')} aria-label={t('present.help')}
        >
          <i class="fa-solid fa-circle-question" aria-hidden="true" />
        </button>
        <div class="pz-appbar__menu-wrap">
          <button
            type="button" class="pz-btn pz-btn--icon" onClick={() => setBarMenuOpen(open => !open)}
            aria-haspopup="menu" aria-expanded={barMenuOpen}
            title={t('present.app.moreTooltip')} aria-label={t('present.app.moreTooltip')}
          >
            <i class="fa-solid fa-ellipsis" aria-hidden="true" />
          </button>
          {barMenuOpen && (
            <div class="pz-appbar__menu" role="menu">
              <button
                type="button" role="menuitem" class="pz-appbar__menu-item"
                onClick={() => { update(EMPTY_PREFS, true); setBarMenuOpen(false); }}
              >
                {t('present.app.resetLayout')}
              </button>
            </div>
          )}
        </div>
      </header>

      {layout === 'phone' ? (
        <PhoneLayout onOpenHelp={() => setHelpOpen(true)} onAddToNotes={onAddToNotes} />
      ) : (
        <div
          class="pz-grid"
          ref={gridRef}
          style={{ gridTemplateColumns: `${notesFraction * 100}% ${SPLITTER_PX}px minmax(0, 1fr)` }}
        >
          <NotesPane />
          <Splitter
            orientation="vertical"
            label={t('present.app.resizeColumns')}
            onDrag={dragColumns}
            onDragEnd={() => savePrefs(prefsRef.current)}
            onNudge={nudgeColumns}
          />
          <div class="pz-right" ref={rightRef}>
            <div class="pz-right__control" style={{ height: `${rows.controlHeight}px` }}>
              <ControlPane onOpenHelp={() => setHelpOpen(true)} onAddToNotes={onAddToNotes} />
            </div>
            <Splitter
              orientation="horizontal"
              label={t('present.app.resizeRows')}
              onDrag={dragRows}
              onDragEnd={() => savePrefs(prefsRef.current)}
              onNudge={nudgeRows}
            />
            <section class="pz-pane pz-preview" aria-label={t('present.app.preview')} style={{ height: `${rows.previewHeight}px` }}>
              {/* Before going live the preview runs on the local, offline session. */}
              <div class="pz-preview__screen" style={{ width: `${screen.width}px` }}>
                <PresentPreview
                  joinCode={session?.joinCode}
                  localState={session ? undefined : presenterState}
                  interactive
                  onIntent={presenterSend}
                />
              </div>
            </section>
          </div>
        </div>
      )}

      <PresentHelp isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
