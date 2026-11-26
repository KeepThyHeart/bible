/**
 * Chapter mode: a whole chapter, each verse (formatted as the Bible pane formats it) with its
 * note directly below. Exactly one note is editable at a time; the rest are read-only viewers.
 * See the 0216 design, sections 1 and 3.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useI18n } from '../../../contexts/useI18n';
import { useBibleStore } from '../../../stores/useBibleStore';
import { useTextSettingsStore, getFontFamilyCSS } from '../../../stores/useTextSettingsStore';
import type { ChapterModeNavState } from '../../../stores/notesChapterNavState';
import { calculateVerseId, getBookNameFromCache, parseVerseId } from '../../../utils/verseReference';
import { contentDirAttrs } from '../../../utils/contentDirection';
import { requestCompilePassageNotes } from '../../../services/compile/compileRequest';
import { adjacentChapter } from '../../bible/adjacentChapter';
import ChapterNotesToolbar from './ChapterNotesToolbar';
import ChapterVerseRow, { type ChapterVerseTextProps } from './ChapterVerseRow';
import { chapterTitle } from './chapterTitle';
import { useChapterNotes, type ChapterRow } from './useChapterNotes';
import { useChapterActiveEditor } from './useChapterActiveEditor';
import { useChapterFollow, type ChapterFollowTarget } from './useChapterFollow';
import { usePrimaryBibleChapter } from './usePrimaryBibleChapter';
import { NotesZoomApplied, useNotesZoomStyle } from '../NotesZoom';
import { useCtrlWheelNotesZoom } from '../../../hooks/useCtrlWheelNotesZoom';

export interface ChapterNotesHandle {
  openVerse(verseId: number, opts?: { focus?: boolean }): void;
  flush(): Promise<void>;
  /** Flush and close the open editor (every row shows its viewer). */
  deactivate(): void;
}

export interface ChapterNotesViewProps {
  panelId: string;
  isDetached: boolean;
  state: ChapterModeNavState;
  onStateChange: (update: (prev: ChapterModeNavState) => ChapterModeNavState) => void;
  /** Called after the active note was flushed. */
  onExitToSingle: (verseId: number | null) => void;
  /** Defaults to opening the Compile dialog prefilled with the reference. */
  onCompile?: (reference: string) => void;
  handleRef?: React.MutableRefObject<ChapterNotesHandle | null>;
  /** The pane's pop-out handler; the button is omitted when absent (and in a pop-out). */
  onPopOut?: () => void;
}

const SCROLL_THROTTLE_MS = 300;

const ChapterNotesView: React.FC<ChapterNotesViewProps> = ({
  panelId, isDetached, state, onStateChange, onExitToSingle, onCompile, handleRef, onPopOut,
}) => {
  const { t } = useI18n();
  const origin = `chapter:${panelId}`;
  const primary = usePrimaryBibleChapter(isDetached);
  const availableBibles = useBibleStore(s => s.availableBibles);
  const bibles = availableBibles ?? [];
  const textSettings = useTextSettingsStore(s => s.getSettings('bible'));

  const notes = useChapterNotes({
    book: state.book,
    chapter: state.chapter,
    translation: state.translation ?? primary.translation ?? undefined,
    origin,
  });
  const editor = useChapterActiveEditor({ origin, onSaved: notes.setRecord });
  const { active } = editor;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomStyle = useNotesZoomStyle();
  useCtrlWheelNotesZoom(scrollRef);
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ state, rows: notes.rows, folderName: notes.folderName, status: notes.status });
  latest.current = { state, rows: notes.rows, folderName: notes.folderName, status: notes.status };
  /** The verse a load of the editor was last requested for, in this chapter. */
  const requested = useRef<number | null>(null);
  const pendingFocus = useRef(false);
  /** The next activation came from Follow, the keyboard or the pane handler: scroll its row to the top. */
  const scrollToStart = useRef(false);

  // --- activation -----------------------------------------------------------------

  const doActivate = useCallback((verse: number) => {
    const { rows, folderName, state: s } = latest.current;
    // Match by id: right after a chapter change the rows can still be the previous chapter's.
    const wanted = calculateVerseId(s.book, s.chapter, verse);
    const row = rows.find(r => r.verseId === wanted);
    if (!row) return;
    if (requested.current === row.verseId) return;
    requested.current = row.verseId;
    const focus = pendingFocus.current;
    pendingFocus.current = false;
    void editorRef.current.activate({ verseId: row.verseId, folderName, chapter: s.chapter, verse, record: row.record }, { focus });
  }, []);

  const activateVerse = useCallback((verse: number, focus: boolean) => {
    pendingFocus.current = focus;
    if (latest.current.state.activeVerse === verse) doActivate(verse);
    else onStateChange(prev => ({ ...prev, activeVerse: verse }));
  }, [doActivate, onStateChange]);

  const deactivate = useCallback(() => {
    requested.current = null;
    pendingFocus.current = false;
    void editorRef.current.deactivate();
    onStateChange(prev => (prev.activeVerse === undefined ? prev : { ...prev, activeVerse: undefined }));
  }, [onStateChange]);

  // state.activeVerse is the single source: activate it once its row exists.
  useEffect(() => {
    if (notes.status !== 'ready' || state.activeVerse === undefined) return;
    doActivate(state.activeVerse);
  }, [notes.status, notes.rows, state.activeVerse, doActivate]);

  // A chapter change closes the editor of the old chapter (flushing it).
  const activeVerseId = active?.verseId ?? null;
  useEffect(() => {
    requested.current = null;
  }, [state.book, state.chapter]);
  useEffect(() => {
    if (activeVerseId === null) return;
    const p = parseVerseId(activeVerseId);
    if (p.bookNumber !== state.book || p.chapter !== state.chapter) {
      requested.current = null;
      void editorRef.current.deactivate();
    }
  }, [activeVerseId, state.book, state.chapter]);

  // --- chapter moves ----------------------------------------------------------------

  const goTo = useCallback((book: number, chapter: number, verse?: number) => {
    onStateChange(prev => {
      if (prev.book === book && prev.chapter === chapter && verse === undefined) return prev;
      const sameChapter = prev.book === book && prev.chapter === chapter;
      return {
        ...prev,
        book,
        chapter,
        activeVerse: verse ?? (sameChapter ? prev.activeVerse : undefined),
        anchorVerse: sameChapter ? prev.anchorVerse : undefined,
      };
    });
  }, [onStateChange]);

  const onFollowTarget = useCallback((target: ChapterFollowTarget) => {
    const verse = target.verseId !== undefined ? parseVerseId(target.verseId).verse : undefined;
    pendingFocus.current = false;
    scrollToStart.current = true;
    goTo(target.book, target.chapter, verse);
    if (verse !== undefined && latest.current.state.book === target.book && latest.current.state.chapter === target.chapter) {
      if (latest.current.state.activeVerse === verse && latest.current.status === 'ready') doActivate(verse);
    }
  }, [goTo, doActivate]);

  const follow = useChapterFollow({
    panelId, follow: state.follow, book: state.book, chapter: state.chapter, primary, onTarget: onFollowTarget,
  });

  const step = useCallback((direction: 'prev' | 'next') => {
    const to = adjacentChapter(state.book, state.chapter, direction);
    if (to) goTo(to.book, to.chapter);
  }, [state.book, state.chapter, goTo]);
  const prevChapter = useMemo(() => adjacentChapter(state.book, state.chapter, 'prev'), [state.book, state.chapter]);
  const nextChapter = useMemo(() => adjacentChapter(state.book, state.chapter, 'next'), [state.book, state.chapter]);

  const toggleFollow = useCallback(() => {
    const turningOn = !state.follow;
    onStateChange(prev => ({ ...prev, follow: !prev.follow }));
    if (turningOn) follow.goThere();
  }, [state.follow, onStateChange, follow]);

  // --- visible rows / keyboard ----------------------------------------------------------

  const visibleRows: ChapterRow[] = useMemo(() => {
    if (!state.onlyWithNotes) return notes.rows;
    return notes.rows.filter(r => r.record !== null || r.verseId === activeVerseId || r.verse === state.activeVerse);
  }, [notes.rows, state.onlyWithNotes, state.activeVerse, activeVerseId]);

  const moveActive = useCallback((direction: 1 | -1) => {
    if (visibleRows.length === 0) return;
    scrollToStart.current = true;
    const current = visibleRows.findIndex(r => r.verseId === (activeVerseId ?? -1) || r.verse === state.activeVerse);
    let idx: number;
    if (current < 0) idx = direction === 1 ? 0 : visibleRows.length - 1;
    else idx = current + direction;
    if (idx < 0 || idx >= visibleRows.length) { scrollToStart.current = false; return; }
    activateVerse(visibleRows[idx].verse, true);
  }, [visibleRows, activeVerseId, state.activeVerse, activateVerse]);

  /**
   * Escape in the open editor, noted on the way down: something else (a slash menu, a toolbar
   * menu) may be about to use this Escape, which leaves the row alone. Decided before the editor
   * sees the key so a handler that calls preventDefault does not hide it from us.
   */
  const escapeFromEditor = useRef(false);
  /** The row to hand keyboard focus back to once its editor is gone. */
  const restoreFocusVerse = useRef<number | null>(null);

  const onKeyDownCapture = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      const inActiveRow = !!(e.target as HTMLElement).closest('[data-verse-row][data-active="true"]');
      const menuOpen = !!document.querySelector('[data-tippy-root] [data-state="visible"]');
      escapeFromEditor.current = inActiveRow && !menuOpen;
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
      e.preventDefault();
      e.stopPropagation();
      moveActive(e.key === 'PageDown' ? 1 : -1);
    }
  }, [moveActive]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    const wanted = escapeFromEditor.current;
    escapeFromEditor.current = false;
    if (!wanted || activeVerseId === null) return;
    e.stopPropagation();
    restoreFocusVerse.current = parseVerseId(activeVerseId).verse;
    deactivate();
  }, [activeVerseId, deactivate]);

  // Escape closed the editor: keyboard users keep their place on that row's viewer / Add button.
  useEffect(() => {
    if (activeVerseId !== null || restoreFocusVerse.current === null) return;
    const verse = restoreFocusVerse.current;
    const trigger = rootRef.current?.querySelector<HTMLElement>(`[data-verse-row="${verse}"] [data-row-trigger]`);
    restoreFocusVerse.current = null;
    trigger?.focus();
  }, [activeVerseId]);

  const onBlurCapture = useCallback((e: React.FocusEvent) => {
    const row = (e.target as HTMLElement).closest('[data-verse-row][data-active="true"]');
    if (!row) return;
    const next = e.relatedTarget as Node | null;
    if (next && row.contains(next)) return;
    void editorRef.current.flush();
  }, []);

  // Keep the activated row in view. Follow / keyboard / external activations put the row at the top,
  // so the verse and its editor are both visible; that scroll is repeated once the editor has been
  // laid out (it mounts after this effect, and a row that was loading grows when it is ready).
  const editorLoading = active?.loading ?? false;
  useEffect(() => {
    if (activeVerseId === null) return;
    const toStart = scrollToStart.current;
    const scroll = () => {
      const el = rootRef.current?.querySelector(`[data-verse-row="${parseVerseId(activeVerseId).verse}"]`);
      (el as HTMLElement | null)?.scrollIntoView?.({ block: toStart ? 'start' : 'nearest' });
    };
    scroll();
    if (!toStart) return;
    if (!editorLoading) scrollToStart.current = false;
    const raf = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(raf);
  }, [activeVerseId, editorLoading]);

  // --- scroll anchor ---------------------------------------------------------------------

  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScroll = useCallback(() => {
    if (scrollTimer.current) return;
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = null;
      const box = scrollRef.current;
      if (!box) return;
      const top = box.getBoundingClientRect().top;
      const rowEls = box.querySelectorAll<HTMLElement>('[data-verse-row]');
      for (const el of Array.from(rowEls)) {
        if (el.getBoundingClientRect().bottom > top) {
          const verse = Number(el.dataset.verseRow);
          if (Number.isInteger(verse)) {
            onStateChange(prev => (prev.anchorVerse === verse ? prev : { ...prev, anchorVerse: verse }));
          }
          break;
        }
      }
    }, SCROLL_THROTTLE_MS);
  }, [onStateChange]);
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); }, []);

  // Restore the anchor once per chapter load, unless a row is about to be activated.
  const restoredFor = useRef('');
  useEffect(() => {
    if (notes.status !== 'ready') return;
    const key = `${state.book}:${state.chapter}`;
    if (restoredFor.current === key) return;
    restoredFor.current = key;
    if (state.activeVerse !== undefined || state.anchorVerse === undefined) return;
    const el = rootRef.current?.querySelector(`[data-verse-row="${state.anchorVerse}"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: 'start' });
  }, [notes.status, state.book, state.chapter, state.activeVerse, state.anchorVerse]);

  // --- handle ----------------------------------------------------------------------------

  const openVerse = useCallback((verseId: number, opts?: { focus?: boolean }) => {
    const p = parseVerseId(verseId);
    if (p.verse < 1) return;
    pendingFocus.current = opts?.focus ?? false;
    scrollToStart.current = true;
    const s = latest.current.state;
    if (s.book === p.bookNumber && s.chapter === p.chapter) {
      if (s.activeVerse === p.verse) {
        if (latest.current.status === 'ready') {
          requested.current = null; // re-activate (and focus) even when it is already the active row
          doActivate(p.verse);
        }
      } else onStateChange(prev => ({ ...prev, activeVerse: p.verse }));
    } else {
      onStateChange(prev => ({ ...prev, book: p.bookNumber, chapter: p.chapter, activeVerse: p.verse, anchorVerse: undefined }));
    }
  }, [doActivate, onStateChange]);

  const flush = useCallback(() => editorRef.current.flush(), []);
  // A click on a row only brings it into view ('nearest'): clear any scroll-to-top left over from a
  // Follow or keyboard activation that targeted the row already active (and so never scrolled).
  const onActivateRow = useCallback((verse: number) => {
    scrollToStart.current = false;
    activateVerse(verse, true);
  }, [activateVerse]);
  const onResolveConflict = useCallback((choice: 'overwrite' | 'reload') => { void editorRef.current.resolveConflict(choice); }, []);
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = { openVerse, flush, deactivate };
    return () => { handleRef.current = null; };
  }, [handleRef, openVerse, flush, deactivate]);

  // --- toolbar actions ----------------------------------------------------------------------

  const compile = useCallback(() => {
    const ref = chapterTitle(state);
    if (onCompile) onCompile(ref);
    else requestCompilePassageNotes({ reference: ref });
  }, [state, onCompile]);

  const singleNote = useCallback(async () => {
    const verse = activeVerseId !== null ? parseVerseId(activeVerseId).verse : state.activeVerse;
    await editorRef.current.flush();
    onExitToSingle(verse !== undefined ? calculateVerseId(state.book, state.chapter, verse) : null);
  }, [activeVerseId, state, onExitToSingle]);

  // --- render -----------------------------------------------------------------------------

  const paneTranslation = primary.translation ?? '';
  const activeBible = bibles.find(b => b.abbreviation === notes.translation);
  const textProps: ChapterVerseTextProps = useMemo(() => ({
    ...contentDirAttrs(activeBible?.language_code),
    className: `pane-content-bible${textSettings.showRedLetter === false ? ' no-red-letter' : ''}`,
    style: {
      '--pane-font-family-bible': getFontFamilyCSS(textSettings.fontFamily),
      '--pane-font-size-bible': `${textSettings.fontSize}px`,
      '--pane-line-height-bible': textSettings.lineHeight,
    } as React.CSSProperties,
  }), [activeBible?.language_code, textSettings.showRedLetter, textSettings.fontFamily, textSettings.fontSize, textSettings.lineHeight]);

  const onTranslationChange = useCallback((tr: string) => {
    onStateChange(prev => ({ ...prev, translation: tr === '' ? undefined : tr }));
  }, [onStateChange]);

  const notFollowingRef = follow.notFollowing
    ? `${getBookNameFromCache(follow.notFollowing.book) || ''} ${follow.notFollowing.chapter}`.trim()
    : '';

  return (
    <div
      ref={rootRef}
      className="flex flex-col h-full min-h-0"
      data-testid="chapter-notes-view"
      onKeyDownCapture={onKeyDownCapture}
      onKeyDown={onKeyDown}
      onBlurCapture={onBlurCapture}
    >
      <ChapterNotesToolbar
        title={chapterTitle(state)}
        canPrev={prevChapter !== null}
        canNext={nextChapter !== null}
        onPrev={() => step('prev')}
        onNext={() => step('next')}
        bibles={bibles}
        translation={state.translation ?? ''}
        paneTranslation={paneTranslation}
        onTranslationChange={onTranslationChange}
        follow={state.follow}
        onToggleFollow={toggleFollow}
        onlyWithNotes={state.onlyWithNotes}
        onToggleOnlyWithNotes={() => onStateChange(prev => ({ ...prev, onlyWithNotes: !prev.onlyWithNotes }))}
        onCompile={compile}
        onSingleNote={() => { void singleNote(); }}
        onPopOut={isDetached ? undefined : onPopOut}
      />

      {follow.notFollowing && (
        <div className="flex items-center gap-2 px-3 py-1 text-sm bg-background-secondary border-b border-border" role="status" data-testid="chapter-not-following">
          <span>{t('chapterNotes.notFollowing', { reference: notFollowingRef })}</span>
          <button
            type="button"
            className="px-2 py-0.5 text-xs rounded border border-border-secondary hover:bg-background-hover"
            onClick={follow.goThere}
            data-testid="chapter-go-there"
          >
            {t('chapterNotes.goThere')}
          </button>
        </div>
      )}

      <NotesZoomApplied value={true}>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" style={zoomStyle} onScroll={onScroll} data-testid="chapter-scroll">
        {notes.status === 'loading' && <div className="p-4 text-sm text-text-secondary" role="status">{t('chapterNotes.loading')}</div>}
        {notes.status === 'no-translation' && <div className="p-4 text-sm text-text-secondary" role="status">{t('chapterNotes.noTranslation')}</div>}
        {notes.status === 'error' && (
          <div className="p-4 text-sm" role="alert">
            {t('chapterNotes.loadError')}{' '}
            <button type="button" className="px-2 py-0.5 text-xs rounded border border-border-secondary" onClick={notes.reload}>{t('chapterNotes.retry')}</button>
          </div>
        )}
        {notes.status === 'ready' && visibleRows.length === 0 && (
          <div className="p-4 text-sm text-text-secondary" role="status" data-testid="chapter-empty">
            {state.onlyWithNotes ? t('chapterNotes.noNotesInChapter') : t('chapterNotes.noVerses')}
          </div>
        )}
        {notes.status === 'ready' && visibleRows.map(row => (
          <ChapterVerseRow
            key={row.verseId}
            row={row}
            moduleId={notes.moduleId}
            textProps={textProps}
            active={active && active.verseId === row.verseId ? active : null}
            onActivate={onActivateRow}
            onChange={editor.setHtml}
            onNormalized={editor.normalize}
            onResolveConflict={onResolveConflict}
            preserveSelectionFlag={editor.preserveSelectionFlag}
          />
        ))}
      </div>
      </NotesZoomApplied>
    </div>
  );
};

export default ChapterNotesView;
