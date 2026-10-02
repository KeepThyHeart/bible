import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { XrefHopper, XrefWebView, XrefArcView, XrefCompassView, FullscreenButton, FULLSCREEN_CLASS, useFullscreen } from '@bible/ui';
import { useI18n } from '../contexts/useI18n';
import { useDirection } from '../contexts/useDirection';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { translateWithDefault, useXrefGraphLabels } from '../hooks/useXrefGraphLabels';
import {
  useXrefGraphStore,
  XREF_GRAPH_PHONE_WIDTH,
  type XrefGraphView,
} from '../stores/useXrefGraphStore';
import { useBibleStore } from '../stores/useBibleStore';
import { useBiblePanel } from '../stores/hooks/useBiblePanel';
import { localizedBookNames } from '../constants/bibleBooks';
import { xrefGraphProvider } from '../services/xrefGraphProvider';
import { getVersesCached } from '../services/verseFetchCache';

const VIEW_ORDER: readonly XrefGraphView[] = ['hopper', 'web', 'compass', 'arcs'];
const VIEW_DEFAULTS: Record<XrefGraphView, string> = {
  hopper: 'Hopper',
  web: 'Verse web',
  compass: 'Compass',
  arcs: 'Canon arcs',
};

const bookOf = (verseId: number) => Math.floor(verseId / 1000000);
const chapterOf = (verseId: number) => Math.floor(verseId / 1000) % 1000;
const verseOf = (verseId: number) => verseId % 1000;

function usePhoneWidth(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < XREF_GRAPH_PHONE_WIDTH);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < XREF_GRAPH_PHONE_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return narrow;
}

/**
 * XrefGraphDialog
 *
 * Large modal hosting the shared cross-reference graph views (Hopper, Verse
 * web, Canon arcs) for the anchor verse held in `useXrefGraphStore`.
 */
const XrefGraphDialog: React.FC = () => {
  const { t, localizer } = useI18n();
  const labels = useXrefGraphLabels();
  const direction = useDirection();
  const { isOpen, anchor, view, close, setAnchor, setView } = useXrefGraphStore();
  const phone = usePhoneWidth();
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);
  const { full, toggle: toggleFull, exit: exitFull } = useFullscreen(dialogRef);

  const { openTabs, activeTabIndex } = useBiblePanel();
  const defaultBible = useBibleStore((s) => s.getDefaultBible());
  const activeVersion = openTabs[activeTabIndex]?.abbreviation ?? defaultBible;
  const versionRef = useRef(activeVersion);
  versionRef.current = activeVersion;

  const bookNames = useMemo(() => localizedBookNames(localizer), [localizer]);
  const bookName = useCallback((book: number) => bookNames[book] ?? String(book), [bookNames]);
  const formatChapter = useCallback(
    (book: number, chapter: number) => `${bookName(book)} ${chapter}`,
    [bookName],
  );
  const formatRef = useCallback(
    (verseId: number, endVerseId?: number) => {
      const start = `${bookName(bookOf(verseId))} ${chapterOf(verseId)}:${verseOf(verseId)}`;
      if (endVerseId === undefined || endVerseId === verseId) return start;
      if (bookOf(endVerseId) !== bookOf(verseId)) {
        return `${start}-${bookName(bookOf(endVerseId))} ${chapterOf(endVerseId)}:${verseOf(endVerseId)}`;
      }
      return chapterOf(endVerseId) === chapterOf(verseId)
        ? `${start}-${verseOf(endVerseId)}`
        : `${start}-${chapterOf(endVerseId)}:${verseOf(endVerseId)}`;
    },
    [bookName],
  );

  const getVerseText = useCallback(
    async (verseId: number, endVerseId?: number): Promise<string | undefined> => {
      const version = versionRef.current;
      if (!version) return undefined;
      try {
        const verses = await getVersesCached(version, verseId, endVerseId ?? verseId);
        const text = verses
          .map((v) => (v.text ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' ');
        return text || undefined;
      } catch {
        return undefined;
      }
    },
    [],
  );

  const openVerse = useCallback(
    (verseId: number) => {
      void useBibleStore.getState().navigateToVerseInPrimary(verseId);
      if (window.innerWidth < XREF_GRAPH_PHONE_WIDTH) close();
    },
    [close],
  );

  const openChapter = useCallback(
    (book: number, chapter: number) => openVerse(book * 1000000 + chapter * 1000 + 1),
    [openVerse],
  );

  const exploreChapter = useCallback(
    (book: number, chapter: number) => {
      setAnchor(book * 1000000 + chapter * 1000 + 1);
      setView('web');
    },
    [setAnchor, setView],
  );

  // A phone-width dialog is already full window; a closed one is no longer full screen.
  useEffect(() => {
    if ((phone || !isOpen) && full) exitFull();
  }, [phone, isOpen, full, exitFull]);

  if (!isOpen) return null;

  const title = translateWithDefault(t, 'xrefGraph.title', 'Cross-reference graph');
  const dir = direction === 'rtl' ? 'rtl' : 'ltr';

  const renderView = () => {
    if (anchor === null) {
      return (
        <p className="p-lg text-sm text-text-secondary">
          {translateWithDefault(t, 'xrefGraph.noVerse', 'Select a verse to explore its connections')}
        </p>
      );
    }
    if (view === 'hopper') {
      return (
        <XrefHopper
          provider={xrefGraphProvider}
          anchor={anchor}
          onAnchorChange={setAnchor}
          onOpenVerse={openVerse}
          formatRef={formatRef}
          getVerseText={getVerseText}
          labels={labels.hopper}
          dir={dir}
        />
      );
    }
    if (view === 'web') {
      return (
        <XrefWebView
          provider={xrefGraphProvider}
          anchor={anchor}
          onAnchorChange={setAnchor}
          onOpenVerse={openVerse}
          formatRef={formatRef}
          getVerseText={getVerseText}
          labels={labels.web}
          dir={dir}
        />
      );
    }
    if (view === 'compass') {
      return (
        <XrefCompassView
          provider={xrefGraphProvider}
          anchor={anchor}
          onAnchorChange={setAnchor}
          onOpenVerse={openVerse}
          formatRef={formatRef}
          bookName={bookName}
          getVerseText={getVerseText}
          labels={labels.compass}
          dir={dir}
        />
      );
    }
    return (
      <XrefArcView
        provider={xrefGraphProvider}
        current={{ book: bookOf(anchor), chapter: chapterOf(anchor) }}
        onOpenChapter={openChapter}
        onExploreChapter={exploreChapter}
        bookName={bookName}
        formatChapter={formatChapter}
        labels={labels.arcs}
        dir={dir}
      />
    );
  };

  const frameClass = phone
    ? 'bg-surface shadow-xl w-screen h-screen flex flex-col'
    : full
    ? `bg-surface flex flex-col ${FULLSCREEN_CLASS}`
    : 'bg-surface rounded-lg shadow-xl w-[90vw] h-[85vh] max-w-6xl flex flex-col';

  return (
    <>
      <div className="fixed inset-0 bg-background-overlay z-40" aria-hidden="true" onClick={close} />
      <div className={`fixed inset-0 flex items-center justify-center z-50 ${phone ? '' : 'p-lg'}`}>
        <div
          ref={dialogRef}
          className={frameClass}
          data-testid="xref-graph-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="xref-graph-dialog-title"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // A view that uses Escape itself (clearing a selection) has
            // already handled the event; only an untouched Escape closes.
            if (e.key === 'Escape' && !e.defaultPrevented) {
              // In full screen the first Escape leaves it: useFullscreen (on the document) handles it.
              if (full) return;
              e.stopPropagation();
              close();
            }
          }}
        >
          <div className="flex items-center justify-between px-lg py-md border-b border-border">
            <h2 id="xref-graph-dialog-title" className="text-lg font-bold text-text-heading">
              {title}
            </h2>
            <div className="flex items-center gap-sm">
              {!phone && (
                <FullscreenButton
                  full={full}
                  onToggle={toggleFull}
                  labels={{
                    enter: translateWithDefault(t, 'xrefGraph.fullscreen', 'Full screen'),
                    exit: translateWithDefault(t, 'xrefGraph.exitFullscreen', 'Exit full screen'),
                  }}
                />
              )}
              <button
                type="button"
                onClick={close}
                className="px-sm py-xs text-sm rounded border border-border text-text-primary hover:bg-background-hover"
                aria-label={translateWithDefault(t, 'xrefGraph.close', 'Close')}
              >
                {translateWithDefault(t, 'xrefGraph.close', 'Close')}
              </button>
            </div>
          </div>
          <div
            role="tablist"
            aria-label={translateWithDefault(t, 'xrefGraph.views', 'Graph views')}
            className="flex gap-xs px-lg pt-sm border-b border-border overflow-x-auto"
          >
            {VIEW_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`xref-graph-tab-${id}`}
                aria-selected={view === id}
                aria-controls="xref-graph-panel"
                tabIndex={view === id ? 0 : -1}
                onClick={() => setView(id)}
                onKeyDown={(e) => {
                  const i = VIEW_ORDER.indexOf(id);
                  const next =
                    e.key === 'ArrowRight' ? VIEW_ORDER[(i + 1) % VIEW_ORDER.length]
                    : e.key === 'ArrowLeft' ? VIEW_ORDER[(i + VIEW_ORDER.length - 1) % VIEW_ORDER.length]
                    : null;
                  if (next) {
                    e.preventDefault();
                    setView(next);
                    document.getElementById(`xref-graph-tab-${next}`)?.focus();
                  }
                }}
                className={`px-md py-sm text-sm border-b-2 whitespace-nowrap ${
                  view === id
                    ? 'border-accent text-text-heading font-semibold'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                {translateWithDefault(t, `xrefGraph.view.${id}`, VIEW_DEFAULTS[id])}
              </button>
            ))}
          </div>
          <div
            id="xref-graph-panel"
            role="tabpanel"
            aria-labelledby={`xref-graph-tab-${view}`}
            className="flex-1 min-h-0 overflow-auto"
          >
            {renderView()}
          </div>
        </div>
      </div>
    </>
  );
};

export default XrefGraphDialog;
