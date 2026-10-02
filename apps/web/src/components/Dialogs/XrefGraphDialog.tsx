import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { useTranslation } from 'react-i18next';
import { XrefHopper, XrefWebView, XrefArcView, XrefCompassView, FullscreenButton, FULLSCREEN_CLASS, useFullscreen } from '@bible/ui';
import type { XrefHopperProps, XrefWebViewProps, XrefArcViewProps, XrefCompassViewProps } from '@bible/ui';
import { xrefGraphStore } from '../../stores/xrefGraphStore';
import type { XrefGraphView } from '../../stores/xrefGraphStore';
import { bibleStore } from '../../stores/bibleStore';
import { useStore } from '../../hooks/useStore';
import { useXrefGraphLabels } from '../../hooks/useXrefGraphLabels';
import { xrefGraphProvider } from '../../providers/XrefGraphProvider';
import { getLocalizedBookName } from '../../utils/bookNames';
import { logicalArrow } from '@bible/core/browser';
import { formatVerseRange, parseVerseId } from '../../utils/verseId';
import { formatPassageRef } from '../../constants';
import type { IBibleDataProvider } from '../../providers/interfaces';

// The shared views are typed against React; Preact (aliased as react) renders them fine, but the
// declared component types differ, so they are cast once here at the boundary.
const Hopper = XrefHopper as unknown as ComponentType<XrefHopperProps>;
const WebView = XrefWebView as unknown as ComponentType<XrefWebViewProps>;
const ArcView = XrefArcView as unknown as ComponentType<XrefArcViewProps>;
const CompassView = XrefCompassView as unknown as ComponentType<XrefCompassViewProps>;

const VIEWS: XrefGraphView[] = ['hopper', 'web', 'compass', 'arcs'];
const PHONE_WIDTH = 600;

const isPhone = () => window.innerWidth < PHONE_WIDTH;

interface XrefGraphDialogProps {
  bibleProvider?: IBibleDataProvider;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function XrefGraphDialogInner({ bibleProvider }: XrefGraphDialogProps) {
  const { t } = useTranslation();
  const labels = useXrefGraphLabels();
  const anchor = useStore(xrefGraphStore, () => xrefGraphStore.anchor);
  const view = useStore(xrefGraphStore, () => xrefGraphStore.view);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { full, toggle: toggleFull } = useFullscreen(dialogRef);
  // Captured during the first render, before focus moves into the dialog.
  const [opener] = useState<Element | null>(() => document.activeElement);

  useEffect(() => {
    dialogRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Close on Escape unless a view already handled it (the arc and web views clear a selection first).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      // In full screen the first Escape leaves it: useFullscreen handles it first and marks the event handled.
      xrefGraphStore.close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const formatRef = useCallback(
    (id: number, end?: number) => formatVerseRange(id, end),
    [],
  );

  const getVerseText = useCallback(async (id: number, end?: number): Promise<string | undefined> => {
    if (!bibleProvider) return undefined;
    try {
      const moduleAbbr = bibleStore.getActiveModule();
      let ids = [id];
      if (end && end > id) {
        const a = parseVerseId(id);
        const b = parseVerseId(end);
        if (a.bookNumber === b.bookNumber && a.chapter === b.chapter && b.verse - a.verse < 40) {
          ids = [];
          for (let v = a.verse; v <= b.verse; v++) ids.push(id + (v - a.verse));
        }
      }
      const batch = await bibleProvider.getVerseTexts(moduleAbbr, ids);
      const parts = ids.map(i => {
        const entry = batch.verses[String(i)];
        return entry ? stripTags(entry.text_html || entry.text || '') : '';
      }).filter(Boolean);
      return parts.length ? parts.join(' ') : undefined;
    } catch {
      return undefined;
    }
  }, [bibleProvider]);

  const afterOpen = () => { if (isPhone()) xrefGraphStore.close(); };

  const onOpenVerse = useCallback((id: number, end?: number) => {
    const a = parseVerseId(id);
    let endVerse: number | undefined;
    if (end && end !== id) {
      const b = parseVerseId(end);
      if (b.bookNumber === a.bookNumber && b.chapter === a.chapter) endVerse = b.verse;
    }
    void bibleStore.navigateTo(a.bookNumber, a.chapter, a.verse, { endVerse });
    afterOpen();
  }, []);

  const onOpenChapter = useCallback((book: number, chapter: number) => {
    void bibleStore.navigateTo(book, chapter);
    afterOpen();
  }, []);

  const onExploreChapter = useCallback((book: number, chapter: number) => {
    xrefGraphStore.setAnchor(book * 1000000 + chapter * 1000 + 1);
    xrefGraphStore.setView('web');
  }, []);

  const onTabKey = (e: KeyboardEvent, index: number) => {
    let next = -1;
    // Roving focus follows the UI direction: ArrowRight is "previous" in an RTL tab strip.
    const step = logicalArrow(e.key, document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr');
    if (step === 'next') next = (index + 1) % VIEWS.length;
    else if (step === 'prev') next = (index + VIEWS.length - 1) % VIEWS.length;
    if (next < 0) return;
    e.preventDefault();
    xrefGraphStore.setView(VIEWS[next]);
    requestAnimationFrame(() => document.getElementById(`xref-graph-tab-${VIEWS[next]}`)?.focus());
  };

  const tabLabel: Record<XrefGraphView, string> = {
    hopper: t('xrefGraph.view.hopper', { defaultValue: 'Hopper' }),
    web: t('xrefGraph.view.web', { defaultValue: 'Verse web' }),
    compass: t('xrefGraph.view.compass', { defaultValue: 'Compass' }),
    arcs: t('xrefGraph.view.arcs', { defaultValue: 'Canon arcs' }),
  };

  const current = anchor
    ? (() => { const p = parseVerseId(anchor); return { book: p.bookNumber, chapter: p.chapter }; })()
    : undefined;

  return (
    <div class="xref-graph-overlay" onClick={() => xrefGraphStore.close()}>
      <div
        ref={dialogRef}
        class={`xref-graph-dialog${full ? ` ${FULLSCREEN_CLASS}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('xrefGraph.title', { defaultValue: 'Cross-reference graph' })}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapTab(e as KeyboardEvent, dialogRef.current)}
      >
        <div class="xref-graph-dialog__header">
          <h3 class="xref-graph-dialog__title">
            <i class="fa-solid fa-diagram-project" />{' '}
            {t('xrefGraph.title', { defaultValue: 'Cross-reference graph' })}
            {anchor ? <span class="xref-graph-dialog__anchor"> {formatPassageRef(...refArgs(anchor))}</span> : null}
          </h3>
          <div class="xref-graph-dialog__actions">
          <FullscreenButton
            full={full}
            onToggle={toggleFull}
            className="xref-graph-dialog__fullscreen"
            labels={{
              enter: t('xrefGraph.fullscreen', { defaultValue: 'Full screen' }),
              exit: t('xrefGraph.exitFullscreen', { defaultValue: 'Exit full screen' }),
            }}
          />
          <button
            type="button"
            class="xref-graph-dialog__close"
            aria-label={t('xrefGraph.close', { defaultValue: 'Close' })}
            onClick={() => xrefGraphStore.close()}
          >
            <i class="fa-solid fa-xmark" />
          </button>
          </div>
        </div>
        <div
          class="xref-graph-dialog__tabs"
          role="tablist"
          aria-label={t('xrefGraph.views', { defaultValue: 'Graph views' })}
        >
          {VIEWS.map((v, i) => (
            <button
              key={v}
              type="button"
              role="tab"
              id={`xref-graph-tab-${v}`}
              aria-selected={view === v}
              aria-controls="xref-graph-panel"
              tabIndex={view === v ? 0 : -1}
              class={`xref-graph-dialog__tab${view === v ? ' xref-graph-dialog__tab--active' : ''}`}
              onClick={() => xrefGraphStore.setView(v)}
              onKeyDown={(e) => onTabKey(e as KeyboardEvent, i)}
            >
              {tabLabel[v]}
            </button>
          ))}
        </div>
        <div
          class="xref-graph-dialog__body"
          id="xref-graph-panel"
          role="tabpanel"
          aria-labelledby={`xref-graph-tab-${view}`}
        >
          {!anchor ? (
            <div class="xref-graph-dialog__empty">
              {t('xrefGraph.noVerse', { defaultValue: 'Select a verse to explore its connections' })}
            </div>
          ) : view === 'hopper' ? (
            <Hopper
              provider={xrefGraphProvider}
              anchor={anchor}
              onAnchorChange={(id) => xrefGraphStore.setAnchor(id)}
              onOpenVerse={onOpenVerse}
              formatRef={formatRef}
              getVerseText={getVerseText}
              labels={labels.hopper}
            />
          ) : view === 'web' ? (
            <WebView
              provider={xrefGraphProvider}
              anchor={anchor}
              onAnchorChange={(id) => xrefGraphStore.setAnchor(id)}
              onOpenVerse={onOpenVerse}
              formatRef={formatRef}
              getVerseText={getVerseText}
              labels={labels.web}
            />
          ) : view === 'compass' ? (
            <CompassView
              provider={xrefGraphProvider}
              anchor={anchor}
              onAnchorChange={(id) => xrefGraphStore.setAnchor(id)}
              onOpenVerse={onOpenVerse}
              formatRef={formatRef}
              bookName={getLocalizedBookName}
              getVerseText={getVerseText}
              labels={labels.compass}
            />
          ) : (
            <ArcView
              provider={xrefGraphProvider}
              current={current}
              onOpenChapter={onOpenChapter}
              onExploreChapter={onExploreChapter}
              bookName={getLocalizedBookName}
              formatChapter={(book, chapter) => formatPassageRef(book, chapter)}
              labels={labels.arcs}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function refArgs(id: number): [number, number, number] {
  const p = parseVerseId(id);
  return [p.bookNumber, p.chapter, p.verse];
}

/** Modal "Cross-reference graph": tabs for the shared hopper, verse web and canon arc views. Mounted only while open. */
/** Keep Tab and Shift+Tab inside the modal dialog (aria-modal does not do it by itself). */
function trapTab(e: KeyboardEvent, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return;
  const items = Array.from(
    root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && el.offsetParent !== null);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

export function XrefGraphDialog({ bibleProvider }: XrefGraphDialogProps) {
  const isOpen = useStore(xrefGraphStore, () => xrefGraphStore.isOpen);
  if (!isOpen) return null;
  return <XrefGraphDialogInner bibleProvider={bibleProvider} />;
}
