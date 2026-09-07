import { useState, useRef, useCallback, useEffect } from 'preact/hooks';
import type { VNode } from 'preact';
import { useViewportPosition } from './useViewportPosition';
import { useStore } from './useStore';
import { bibleStore } from '../stores/bibleStore';
import { settingsStore } from '../stores/settingsStore';
import { formatPassageRef } from '../constants';
import { parseVerseId } from '../utils/verseId';
import { toPreviewHtml } from '../utils/verseHtml';
import type { IBibleDataProvider } from '../providers/interfaces';

// ── Types ──────────────────────────────────────────────────────────────

interface PopupPosition {
  top: number;
  left: number;
  anchorTop?: number;
}

/**
 * The formatted verse HTML is carried through the state and the cache *raw*,
 * and reduced for display at paint time. Storing the display string instead
 * would bake the "Words of Christ in red" setting into the hover cache, so a
 * verse previewed before the reader flipped that switch would keep rendering
 * the old way until the page reloaded.
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

function getPopupStyle(position: PopupPosition): Record<string, string> {
  const style: Record<string, string> = {};
  const pad = 8;
  const gap = 4;
  const estimatedHeight = 120; // conservative estimate for popup height
  // Use visualViewport when available so mobile browser chrome (URL bar, etc.)
  // is properly excluded — falls back to innerHeight on older browsers.
  const vv = window.visualViewport;
  const viewportHeight = vv ? vv.height : window.innerHeight;
  const viewportWidth = vv ? vv.width : window.innerWidth;
  const popupMaxWidth = Math.min(400, viewportWidth - 16);
  const left = Math.max(pad, Math.min(position.left, viewportWidth - popupMaxWidth - pad));
  style.left = `${left}px`;
  const spaceBelow = viewportHeight - position.top - pad;
  if (spaceBelow < estimatedHeight && position.anchorTop != null) {
    // Position above the anchor element
    const bottomPos = viewportHeight - position.anchorTop + gap;
    // Ensure it doesn't go off the top of the screen
    style.bottom = `${Math.min(bottomPos, viewportHeight - pad - estimatedHeight)}px`;
    // Constrain to space available above the anchor
    style.maxHeight = `${Math.max(estimatedHeight, position.anchorTop - gap - pad)}px`;
  } else if (spaceBelow < estimatedHeight) {
    // No anchor top available — position from bottom with enough room
    style.bottom = `${pad}px`;
    style.maxHeight = `${viewportHeight - pad * 2}px`;
  } else {
    style.top = `${position.top}px`;
    // Constrain max-height to available space below
    style.maxHeight = `${spaceBelow}px`;
  }
  return style;
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
  const tooltipRef = useViewportPosition<HTMLDivElement>(tooltip?.position ?? null, [tooltip?.reference]);

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
        const rect = anchorEl.getBoundingClientRect();
        setTooltip({ ...cached, position: { top: rect.bottom + 4, left: rect.left, anchorTop: rect.top } });
        return;
      }

      try {
        const verseData = await bibleProvider.getVerse(moduleAbbr, verseId);
        const reference = formatRef(verseId);
        const html = verseData.text_html || verseData.text || '';
        tooltipCacheRef.current.set(cacheKey, { html, reference });
        const rect = anchorEl.getBoundingClientRect();
        setTooltip({ html, reference, position: { top: rect.bottom + 4, left: rect.left, anchorTop: rect.top } });
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
      bibleStore.addTabWithPassage(bibleStore.getActiveTab()?.moduleAbbr || 'KJV', bookNumber, chapter, verse || undefined);
    } else if (window.matchMedia('(pointer: coarse)').matches && bibleProvider) {
      // Mobile: show verse preview popup
      const moduleAbbr = bibleStore.getActiveTab()?.moduleAbbr || 'KJV';
      const reference = formatRef(verseId, endVerseId);
      const rect = anchorEl.getBoundingClientRect();
      const position: PopupPosition = { top: rect.bottom + 4, left: rect.left, anchorTop: rect.top };

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

  // ── Dismiss effects ────────────────────────────────────────────

  useEffect(() => {
    if (!tooltip) return;
    const dismiss = () => setTooltip(null);
    document.addEventListener('touchstart', dismiss, { passive: true });
    return () => document.removeEventListener('touchstart', dismiss);
  }, [tooltip]);

  useEffect(() => {
    if (!popup) return;
    const dismiss = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.verse-link-popup')) setPopup(null);
    };
    document.addEventListener('touchstart', dismiss, { passive: true });
    document.addEventListener('mousedown', dismiss);
    return () => {
      document.removeEventListener('touchstart', dismiss);
      document.removeEventListener('mousedown', dismiss);
    };
  }, [popup]);

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
        <div
          ref={tooltipRef}
          class="verse-ref-tooltip"
          style={{ top: `${tooltip.position.top}px`, left: `${tooltip.position.left}px` }}
        >
          <div class="verse-ref-tooltip__ref">{tooltip.reference}</div>
          <div
            class="verse-ref-tooltip__text"
            dangerouslySetInnerHTML={{ __html: toPreviewHtml(tooltip.html, wordsOfChristInRed) }}
          />
        </div>
      )}
      {popup && (
        <div class="verse-link-popup" style={getPopupStyle(popup.position)}>
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
                <i class="fa-solid fa-spinner fa-spin" style={{ marginRight: '6px' }} />Loading...
              </div>
            )
            : (
              <div
                class="verse-link-popup__text"
                dangerouslySetInnerHTML={{ __html: toPreviewHtml(popup.html, wordsOfChristInRed) }}
              />
            )}
        </div>
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
