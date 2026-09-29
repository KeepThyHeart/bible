import { useState, useRef, useCallback } from 'preact/hooks';
import type { VNode } from 'preact';
import { Popover } from '@bible/ui';
import type { PopupRect } from '@bible/core/browser';
import { useStore } from './useStore';
import { bibleStore } from '../stores/bibleStore';
import { settingsStore } from '../stores/settingsStore';
import { formatPassageRef } from '../constants';
import { parseVerseId } from '../utils/verseId';
import { toPreviewHtml } from '../utils/verseHtml';
import type { IBibleDataProvider } from '../providers/interfaces';

// ── Types ──────────────────────────────────────────────────────────────

/** The trigger link's viewport rectangle; the shared Popover places itself below it, or above when there is no room. */
type PopupPosition = PopupRect;

function anchorOf(el: HTMLElement): PopupPosition {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}

/**
 * The formatted verse HTML is carried through the state and the cache *raw*,
 * and reduced for display at paint time. Storing the display string instead
 * would bake the "Words of Christ in red" setting into the hover cache, so a
 * verse previewed before the reader flipped that switch would keep rendering
 * at the previous setting until the page reloaded.
 */
interface TooltipState {
  html: string;
  reference: string;
  position: PopupPosition;
}

interface VerseLinkPopupState {
  html: string;
  reference: string;
  bookNumber: number;
  chapter: number;
  verse: number;
  endVerseId?: number;
  position: PopupPosition;
  loading?: boolean;
}

export interface UseVersePopupResult {
  /** Attach these to a container to get delegated .scripture-link handling */
  containerProps: {
    onClick: (e: Event) => void;
    onMouseOver: (e: MouseEvent) => void;
    onMouseOut: () => void;
  };
  /** For direct use on individual link elements (e.g. cross-refs) */
  handleHover: (verseId: number, e: MouseEvent) => void;
  handleLeave: () => void;
  handleClick: (verseId: number, e: MouseEvent, endVerseId?: number) => void;
  /** Render this inside your component to show tooltip/popup */
  popupJsx: VNode | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function parseVerseHref(href: string): { startVerseId: number; endVerseId?: number } | null {
  const match = href.match(/#verse-(\d+)(?:-(\d+))?/);
  if (!match) return null;
  return {
    startVerseId: parseInt(match[1], 10),
    endVerseId: match[2] ? parseInt(match[2], 10) : undefined,
  };
}

function formatRef(verseId: number, endVerseId?: number): string {
  const { bookNumber, chapter, verse } = parseVerseId(verseId);
  const base = formatPassageRef(bookNumber, chapter, verse);
  if (!endVerseId || endVerseId === verseId) return base;
  const end = parseVerseId(endVerseId);
  if (end.bookNumber === bookNumber && end.chapter === chapter) {
    return `${base}-${end.verse}`;
  }
  return `${base}–${formatPassageRef(end.bookNumber, end.chapter, end.verse)}`;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useVersePopup(bibleProvider?: IBibleDataProvider): UseVersePopupResult {
  // Hover tooltip state
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keyed by `module:verseId`, not by verse id alone. The reader can change
  // translation while this ref lives, and a verse-id-only key would keep
  // serving the old translation's text in every hover preview afterwards.
  const tooltipCacheRef = useRef<Map<string, { html: string; reference: string }>>(new Map());
  const wordsOfChristInRed = useStore(settingsStore, () => settingsStore.wordsOfChristInRed);

  // Mobile click-to-preview popup state
  const [popup, setPopup] = useState<VerseLinkPopupState | null>(null);

  // ── Core logic (shared by delegated & direct modes) ────────────

  const showTooltip = useCallback((verseId: number, anchorEl: HTMLElement) => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (!bibleProvider) return;
    const moduleAbbr = bibleStore.getActiveTab()?.moduleAbbr;
    if (!moduleAbbr) return;

    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);

    hoverTimeoutRef.current = setTimeout(async () => {
      const cacheKey = `${moduleAbbr}:${verseId}`;
      const cached = tooltipCacheRef.current.get(cacheKey);
      if (cached) {
        setTooltip({ ...cached, position: anchorOf(anchorEl) });
        return;
      }

      try {
        const verseData = await bibleProvider.getVerse(moduleAbbr, verseId);
        const reference = formatRef(verseId);
        const html = verseData.text_html || verseData.text || '';
        tooltipCacheRef.current.set(cacheKey, { html, reference });
        setTooltip({ html, reference, position: anchorOf(anchorEl) });
      } catch { /* verse not found */ }
    }, 300);
  }, [bibleProvider]);

  const hideTooltip = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setTooltip(null);
  }, []);

  const navigateOrPopup = useCallback((verseId: number, anchorEl: HTMLElement, e: MouseEvent, endVerseId?: number) => {
    const { bookNumber, chapter, verse } = parseVerseId(verseId);
    const MAX_PREVIEW_CHARS = 300;

    if (e.ctrlKey || e.metaKey) {
      bibleStore.addTabWithPassage(bibleStore.getActiveModule(), bookNumber, chapter, verse || undefined);
    } else if (window.matchMedia('(pointer: coarse)').matches && bibleProvider) {
      // Mobile: show verse preview popup
      const moduleAbbr = bibleStore.getActiveModule();
      const reference = formatRef(verseId, endVerseId);
      const position: PopupPosition = anchorOf(anchorEl);

      // For ranges, fetch multiple verses
      if (endVerseId && endVerseId !== verseId) {
        setPopup({ html: '', reference, bookNumber, chapter, verse, endVerseId, position, loading: true });
        const endParsed = parseVerseId(endVerseId);
        const verseCount = (endParsed.bookNumber === bookNumber && endParsed.chapter === chapter)
          ? endParsed.verse - verse + 1
          : 5; // cross-chapter: cap at 5
        // If 2 verses, fetch both; if >2, fetch only the first (we'll append ellipsis)
        const fetchCount = verseCount <= 2 ? verseCount : 1;
        const verseIds = Array.from({ length: Math.min(fetchCount, 10) }, (_, i) => verseId + i);
        bibleProvider.getVerseTexts(moduleAbbr, verseIds).then(result => {
          let combined = '';
          for (const id of verseIds) {
            const entry = result.verses[String(id)];
            if (!entry) continue;
            const clean = entry.text_html || entry.text || '';
            if (combined) combined += ' ';
            combined += clean;
          }
          if (verseCount > 2) combined += ' \u2026';
          setPopup({ html: combined || '(no text)', reference, bookNumber, chapter, verse, endVerseId, position });
        }).catch(() => {
          setPopup(null);
          bibleStore.navigateToPreview(bookNumber, chapter, verse || undefined);
          window.dispatchEvent(new CustomEvent('navigate-to-bible'));
        });
        return;
      }

      const cacheKey = `${moduleAbbr}:${verseId}`;
      const cached = tooltipCacheRef.current.get(cacheKey);
      if (cached) {
        setPopup({ html: cached.html, reference, bookNumber, chapter, verse, position });
        return;
      }

      setPopup({ html: '', reference, bookNumber, chapter, verse, position, loading: true });
      bibleProvider.getVerse(moduleAbbr, verseId).then(verseData => {
        const html = verseData.text_html || verseData.text || '';
        tooltipCacheRef.current.set(cacheKey, { html, reference });
        setPopup({ html, reference, bookNumber, chapter, verse, position });
      }).catch(() => {
        setPopup(null);
        bibleStore.navigateToPreview(bookNumber, chapter, verse || undefined);
        window.dispatchEvent(new CustomEvent('navigate-to-bible'));
      });
    } else {
      bibleStore.navigateToPreview(bookNumber, chapter, verse || undefined, endVerseId);
      window.dispatchEvent(new CustomEvent('navigate-to-bible'));
    }
  }, [bibleProvider]);

  // ── Dismissal ──────────────────────────────────────────────────
  // Escape, and a mouse or touch press outside, are handled by the shared Popover (`onClose` below).
  // The hover tooltip additionally hides as soon as the pointer leaves the link (containerProps.onMouseOut).

  // ── Delegated container handlers (for .scripture-link in HTML) ─

  const containerOnClick = useCallback((e: Event) => {
    const target = e.target as HTMLElement;
    // Prevent any <a> tag in rendered HTML from causing page navigation
    const anchorEl = target.closest('a');
    if (anchorEl) e.preventDefault();

    const linkEl = target.closest('.scripture-link') as HTMLAnchorElement;
    if (!linkEl) return;
    e.stopPropagation();

    const href = linkEl.getAttribute('href');
    if (!href) return;
    const parsed = parseVerseHref(href);
    if (!parsed) return;

    navigateOrPopup(parsed.startVerseId, linkEl, e as MouseEvent, parsed.endVerseId);
  }, [navigateOrPopup]);

  const containerOnMouseOver = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const linkEl = target.closest('.scripture-link') as HTMLAnchorElement;
    if (!linkEl) return;

    const href = linkEl.getAttribute('href');
    if (!href) return;
    const parsed = parseVerseHref(href);
    if (!parsed) return;

    showTooltip(parsed.startVerseId, linkEl);
  }, [showTooltip]);

  // ── Direct handlers (for individual verse links) ──────────────

  const handleHover = useCallback((verseId: number, e: MouseEvent) => {
    showTooltip(verseId, e.target as HTMLElement);
  }, [showTooltip]);

  const handleClick = useCallback((verseId: number, e: MouseEvent, endVerseId?: number) => {
    e.preventDefault();
    navigateOrPopup(verseId, e.target as HTMLElement, e, endVerseId);
  }, [navigateOrPopup]);

  // ── JSX ────────────────────────────────────────────────────────

  const popupJsx = (
    <>
      {tooltip && (
        <Popover
          open
          anchor={tooltip.position}
          onClose={hideTooltip}
          portal={false}
          role="tooltip"
          width={400}
          estimatedHeight={120}
          padding={8}
          className="verse-ref-tooltip"
          style={{ width: 'auto' }}
        >
          <div class="verse-ref-tooltip__ref">{tooltip.reference}</div>
          <div
            class="verse-ref-tooltip__text"
            dangerouslySetInnerHTML={{ __html: toPreviewHtml(tooltip.html, wordsOfChristInRed) }}
          />
        </Popover>
      )}
      {popup && (
        <Popover
          open
          anchor={popup.position}
          onClose={() => setPopup(null)}
          portal={false}
          width={400}
          estimatedHeight={120}
          padding={8}
          label={popup.reference}
          className="verse-link-popup"
          style={{ width: 'auto', overflowY: 'hidden' }}
        >
          <div class="verse-link-popup__header">
            <span class="verse-link-popup__ref">{popup.reference}</span>
            <button
              class="verse-link-popup__go"
              onClick={() => {
                setPopup(null);
                bibleStore.navigateToPreview(popup.bookNumber, popup.chapter, popup.verse || undefined, popup.endVerseId);
                window.dispatchEvent(new CustomEvent('navigate-to-bible'));
              }}
            >
              Go <i class="fa-solid fa-arrow-right fa-xs" />
            </button>
          </div>
          {popup.loading
            ? (
              <div class="verse-link-popup__text">
                <i class="fa-solid fa-spinner fa-spin" style={{ marginInlineEnd: '6px' }} />Loading...
              </div>
            )
            : (
              <div
                class="verse-link-popup__text"
                dangerouslySetInnerHTML={{ __html: toPreviewHtml(popup.html, wordsOfChristInRed) }}
              />
            )}
        </Popover>
      )}
    </>
  );

  return {
    containerProps: {
      onClick: containerOnClick,
      onMouseOver: containerOnMouseOver,
      onMouseOut: hideTooltip,
    },
    handleHover,
    handleLeave: hideTooltip,
    handleClick,
    popupJsx: (tooltip || popup) ? popupJsx : null,
  };
}
