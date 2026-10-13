/**
 * The annotations overlay (`shellOverlays`, rendered once by the shell): the highlight colour popover, the note
 * editor dialog and a transient toast. Each renders itself only while `annotationUi` says it is open.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { useTranslation } from 'react-i18next';
import { HighlightSwatch } from '@bible/ui';
import type { HighlightSwatchProps } from '@bible/ui';
import type { HighlightColor } from '@bible/core/browser';
import { useStore } from '../../hooks/useStore';
import { annotationUi } from './annotationUi';
import type { HighlightPopoverState, NoteDialogState } from './annotationUi';
import { annotationStore } from './instance';
import { htmlToText, textToHtml } from './noteText';

// Shared components are typed against React; Preact (aliased as react) renders them fine.
const Swatch = HighlightSwatch as unknown as ComponentType<HighlightSwatchProps>;

const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['yellow', 'green', 'blue', 'red', 'purple', 'orange'];

function useDir(): 'ltr' | 'rtl' {
  return typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
}

function useEscape(onEscape: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onEscape]);
}

function HighlightPopover({ state }: { state: HighlightPopoverState }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const dir = useDir();
  const close = () => annotationUi.closePopover();
  useEscape(close);

  // Sit just below the first selected verse, kept inside the viewport; centred when the verse is not on screen.
  useLayoutEffect(() => {
    const pop = ref.current;
    if (!pop) return;
    const verse = document.querySelector(`[data-verse-id="${state.start}"]`);
    const r = verse?.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!r || r.bottom < 0 || r.top > vh) {
      // rtl-physical: viewport coordinates from getBoundingClientRect
      setPos({ top: Math.max(8, (vh - h) / 2), left: Math.max(8, (vw - w) / 2) });
      return;
    }
    const below = r.bottom + 6;
    const top = below + h + 8 > vh ? Math.max(8, r.top - h - 6) : below;
    const left = Math.min(Math.max(8, (dir === 'rtl' ? r.right - w : r.left) + 8), vw - w - 8);
    setPos({ top, left });
  }, [state.start, dir]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const pick = (hex: string) => {
    close();
    void annotationStore.setHighlight(state.moduleId, state.start, state.end, hex).catch(() => annotationUi.showToast(t('annotations.error')));
  };
  const remove = () => {
    close();
    void annotationStore.removeHighlights(state.moduleId, state.start, state.end).catch(() => annotationUi.showToast(t('annotations.error')));
  };
  const colors = Object.fromEntries(HIGHLIGHT_COLORS.map((c) => [c, t(`annotations.colors.${c}`)])) as Record<HighlightColor, string>;

  return (
    <div
      ref={ref}
      class="kth-annot-popover"
      role="dialog"
      aria-label={t('annotations.highlight.title')}
      // rtl-physical: viewport coordinates from getBoundingClientRect (the anchor side is already mirrored above)
      style={{ top: `${pos?.top ?? 0}px`, left: `${pos?.left ?? 0}px`, visibility: pos ? 'visible' : 'hidden' }}
    >
      <Swatch
        value={state.color}
        dir={dir}
        labels={{ group: t('annotations.highlight.colour'), colors }}
        onChange={({ hex }) => pick(hex)}
      />
      {state.hasHighlight && (
        <button type="button" class="kth-annot-btn kth-annot-btn--quiet" onClick={remove}>
          <i class="fa-solid fa-eraser" aria-hidden="true" /> {t('annotations.highlight.remove')}
        </button>
      )}
    </div>
  );
}

function NoteDialog({ state }: { state: NoteDialogState }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(state.note?.title ?? '');
  const [text, setText] = useState(() => (state.note ? htmlToText(state.note.content) : ''));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A new note whose save failed may still have landed (leader handoff mid-request): the retry looks for it first
  // (notes do not depend on the module, so the lookup passes module 0).
  const attempted = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [opener] = useState<Element | null>(() => document.activeElement);
  const close = () => annotationUi.closeNote();
  useEscape(close);

  useEffect(() => {
    textRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const empty = text.trim() === '' && title.trim() === '';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(false);
    try {
      await fn();
      close();
    } catch (err) {
      console.warn('[annotations] note action failed', err);
      setFailed(true);
      setBusy(false);
    }
  };
  const save = (e: Event) => {
    e.preventDefault();
    if (empty || busy) return;
    const content = textToHtml(text);
    const cleanTitle = title.trim() || undefined;
    void run(async () => {
      let id = state.note?.id;
      if (id === undefined && attempted.current !== null) {
        const { notes } = await annotationStore.fetch(0, state.start, state.end);
        id = notes.find((n) => n.start === state.start && n.end === state.end && n.content === attempted.current)?.id;
      }
      if (state.note === null) attempted.current = content;
      return annotationStore.saveNote({ id, start: state.start, end: state.end, title: cleanTitle, content });
    });
  };
  const remove = () => {
    if (!state.note) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    void run(() => annotationStore.deleteNote(state.note!.id));
  };

  return (
    <div class="settings-panel-overlay" onClick={close}>
      <div
        ref={dialogRef}
        class="kth-annot-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('annotations.note.heading', { reference: state.reference })}
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={save}>
          <div class="kth-annot-dialog__header">
            <h3>
              <i class="fa-solid fa-note-sticky" aria-hidden="true" />
              {t('annotations.note.heading', { reference: state.reference })}
            </h3>
            <button type="button" class="kth-annot-dialog__close" onClick={close} title={t('annotations.close')} aria-label={t('annotations.close')}>
              <i class="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
          <div class="kth-annot-dialog__body">
            <label class="kth-annot-field">
              <span>{t('annotations.note.titleLabel')}</span>
              <input
                type="text"
                maxLength={200}
                value={title}
                placeholder={t('annotations.note.titlePlaceholder')}
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="kth-annot-field">
              <span>{t('annotations.note.textLabel')}</span>
              <textarea
                ref={textRef}
                rows={8}
                value={text}
                placeholder={t('annotations.note.textPlaceholder')}
                onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
              />
            </label>
            {failed && <p class="kth-annot-error" role="alert">{t('annotations.error')}</p>}
            {confirmDelete && <p class="kth-annot-error" role="alert">{t('annotations.note.confirmDelete')}</p>}
          </div>
          <div class="kth-annot-dialog__actions">
            {state.note && (
              <button type="button" class="kth-annot-btn kth-annot-btn--danger" onClick={remove} disabled={busy}>
                {confirmDelete ? t('annotations.note.deleteConfirm') : t('annotations.note.delete')}
              </button>
            )}
            <span class="kth-annot-dialog__spacer" />
            <button type="button" class="kth-annot-btn" onClick={close}>{t('annotations.note.cancel')}</button>
            <button type="submit" class="kth-annot-btn kth-annot-btn--primary" disabled={empty || busy}>{t('annotations.note.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AnnotationOverlay() {
  const popover = useStore(annotationUi, () => annotationUi.popover);
  const note = useStore(annotationUi, () => annotationUi.note);
  const toast = useStore(annotationUi, () => annotationUi.toast);
  return (
    <>
      {popover && <HighlightPopover key={`${popover.moduleId}:${popover.start}:${popover.end}`} state={popover} />}
      {note && <NoteDialog key={`${note.note?.id ?? 'new'}:${note.start}:${note.end}`} state={note} />}
      {toast && <div key={toast.id} class="kth-annot-toast" role="status" aria-live="polite">{toast.text}</div>}
    </>
  );
}
