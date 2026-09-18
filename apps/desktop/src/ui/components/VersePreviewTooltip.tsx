import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../contexts/useI18n';
import { bibleAPI } from '../services/electronAPI';
import { loadBookNamesCache } from '../utils/verseReference';
import { formatVerseReference } from '../utils/verseFormatting';
import { VerseIdHelper } from '@bible/core';
import { useBiblePanel } from '../stores/hooks/useBiblePanel';
import { useBibleStore } from '../stores/useBibleStore';
import { sanitizeHtml } from '../utils/sanitize';
import { usePopupPosition, PopupPortal } from '../hooks/usePopupPosition';
import { getVersesCached, primeVerseCache, type CachedVerse } from '../services/verseFetchCache';
import { useTextSettingsStore } from '../stores/useTextSettingsStore';

/** Fixed popup width, matching the previous hand-rolled positioning. */
const TOOLTIP_WIDTH = 380;
/**
 * First-paint height estimate used for synchronous placement (see
 * `usePopupPosition`). Ranges show up to 10 verses with no context padding
 * (taller); single verses show 2 verses of context before/after (shorter).
 * Either way the inner verse list is capped at `max-h-64` (256px) plus
 * header/footer chrome, so this is a safe upper-bound estimate that the
 * hook's post-mount refinement corrects if actual content differs.
 */
const ESTIMATED_HEIGHT_SINGLE = 220;
const ESTIMATED_HEIGHT_RANGE = 320;

interface VersePreviewTooltipProps {
  /** The starting verse ID to display */
  verseId: number;
  /** Optional ending verse ID for a range (e.g., Romans 8:9-16) */
  endVerseId?: number;
  /** Position to show the tooltip */
  position: { x: number; y: number };
  /**
   * Distance from `position.y` to the top of the popup. Defaults to
   * `usePopupPosition`'s 20px, which suits a popup anchored to the mouse
   * pointer (the cursor glyph has to clear it). A consumer that anchors to the
   * *bottom edge of the reference itself* wants a much smaller gap: 20px there
   * is both visibly detached and a dead zone the pointer has to cross, which
   * fires `mouseout` on the trigger before it ever reaches the popup.
   */
  offsetY?: number;
  /** Callback when tooltip should be closed */
  onClose: () => void;
  /** Callback to cancel any pending close timeout */
  onMouseEnter?: () => void;
  /**
   * Footer hint describing how to follow the reference, e.g. "Ctrl+Click:
   * new tab".
   *
   * This is per-consumer on purpose. Hardcoding it to "Ctrl+Click: new tab -
   * Alt+Click: current tab" would misrepresent five of the six call sites:
   * only the notes *editor* handles both modifiers - the Study pane's
   * cross-references and the read-only note viewer navigate on a plain click
   * and ignore modifiers entirely, so those call sites would be advertising
   * shortcuts that do nothing. Omit it and no footer renders.
   */
  hint?: React.ReactNode;
  /**
   * Renders a "Go to verse" action in the header. Supply the consumer's own
   * navigation so the popup works without the user having to know a
   * modifier-click convention at all.
   */
  onGoToVerse?: () => void;
}

/**
 * Tooltip component that shows a verse preview with context (2 verses before/after)
 */
const VersePreviewTooltip: React.FC<VersePreviewTooltipProps> = ({
  verseId,
  endVerseId,
  position,
  onClose,
  onMouseEnter,
  offsetY,
  hint,
  onGoToVerse
}) => {
  const { t } = useI18n();
  // KAN-34: Determine if this is a range (e.g., Romans 8:9-16)
  const isRange = endVerseId !== undefined && endVerseId > verseId;
  // Get active Bible version from store
  const { openTabs, activeTabIndex } = useBiblePanel();
  const defaultBible = useBibleStore(s => s.getDefaultBible());
  const activeVersion = openTabs[activeTabIndex]?.abbreviation ?? defaultBible;
  /**
   * Words of Christ in red, read from the same Bible-pane text settings the
   * reader sets in Preferences. The popup shows the *same* verse text as the
   * pane, so it has to obey the same switch: previewing a red-letter verse in
   * black (or a red-letter-off reader's verse in red) is a visible mismatch.
   * `.no-red-letter` is the class the Bible pane uses; the rule it triggers
   * (`globals.css`) is global, so it works through the body portal too.
   */
  const showRedLetter = useTextSettingsStore(state => state.getSettings('bible').showRedLetter);

  const [verses, setVerses] = useState<CachedVerse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { ref: tooltipRef, style: popupStyle } = usePopupPosition(position, {
    width: TOOLTIP_WIDTH,
    estimatedHeight: isRange ? ESTIMATED_HEIGHT_RANGE : ESTIMATED_HEIGHT_SINGLE,
    ...(offsetY === undefined ? {} : { offsetY }),
  });
  const targetVerseRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Fetch verse text with context on mount - uses cache for instant display
  // KAN-34: For ranges, fetch the exact range; for single verses, add context
  useEffect(() => {
    const fetchVerses = async () => {
      try {
        setLoading(true);
        setError(null);

        // No Bible installed (or none known yet): nothing to preview from.
        if (!activeVersion) {
          setError('Verse not found');
          return;
        }

        // Ensure book names are loaded
        await loadBookNamesCache(bibleAPI);

        // Parse the verse ID to get book, chapter, verse
        const parsed = VerseIdHelper.parse(verseId);

        let startVerseIdToFetch: number;
        let endVerseIdToFetch: number;

        if (isRange && endVerseId) {
          // KAN-34: For ranges, fetch exactly the specified verses (no context)
          // But limit to 10 verses max as per user request
          const parsedEnd = VerseIdHelper.parse(endVerseId);
          const rangeSize = parsedEnd.verse - parsed.verse + 1;

          if (rangeSize > 10) {
            // Limit to first 10 verses of the range
            startVerseIdToFetch = verseId;
            endVerseIdToFetch = VerseIdHelper.calculate(parsed.bookNumber, parsed.chapter, parsed.verse + 9);
          } else {
            startVerseIdToFetch = verseId;
            endVerseIdToFetch = endVerseId;
          }
        } else {
          // For single verses, add 2 verses of context before and after
          const startVerse = Math.max(1, parsed.verse - 2);
          const endVerse = parsed.verse + 2;
          startVerseIdToFetch = VerseIdHelper.calculate(parsed.bookNumber, parsed.chapter, startVerse);
          endVerseIdToFetch = VerseIdHelper.calculate(parsed.bookNumber, parsed.chapter, endVerse);
        }

        // Fetch verses using the active Bible translation. The cache is
        // shared with the notes editor's verse expansion (see
        // services/verseFetchCache), so once a reference has been previewed,
        // expanding it in a note does no IPC at all.
        const verseData = await getVersesCached(activeVersion, startVerseIdToFetch, endVerseIdToFetch);

        if (verseData.length > 0) {
          setVerses(verseData);
        } else {
          // Try to fetch just the target verse, and seed the shared cache with
          // the result so this fallback runs at most once per range.
          const singleVerse = await bibleAPI.getVerse(activeVersion, verseId);
          if (singleVerse) {
            setVerses([singleVerse]);
            primeVerseCache(activeVersion, startVerseIdToFetch, endVerseIdToFetch, [singleVerse]);
          } else {
            setError('Verse not found');
          }
        }
      } catch (err) {
        console.error('Error fetching verse preview:', err);
        setError('Failed to load verse');
      } finally {
        setLoading(false);
      }
    };

    fetchVerses();
  }, [verseId, endVerseId, isRange, activeVersion]);

  // Scroll to center the target verse after loading (KAN-33)
  // Center the verse unless it's taller than the container, in which case show the top
  useEffect(() => {
    if (!loading && verses.length > 0 && targetVerseRef.current && scrollContainerRef.current) {
      // Use requestAnimationFrame to ensure the DOM has updated
      requestAnimationFrame(() => {
        if (targetVerseRef.current && scrollContainerRef.current) {
          const container = scrollContainerRef.current;
          const target = targetVerseRef.current;

          // Only scroll if necessary (if content overflows)
          if (container.scrollHeight <= container.clientHeight) {
            return;
          }

          const containerHeight = container.clientHeight;
          const targetTop = target.offsetTop;
          const targetHeight = target.offsetHeight;

          // KAN-33: If the target verse is taller than the container,
          // show the top of the verse instead of centering
          if (targetHeight >= containerHeight) {
            // Verse is too tall - scroll to show its top with a small margin
            container.scrollTop = Math.max(0, targetTop - 8);
          } else {
            // Verse fits - center it in the container
            const scrollTop = targetTop - (containerHeight / 2) + (targetHeight / 2);
            container.scrollTop = Math.max(0, scrollTop);
          }
        }
      });
    }
  }, [loading, verses]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Get reference string for the target verse or range
  const getReference = () => {
    if (isRange && endVerseId) {
      // KAN-34: Show range reference (e.g., "Romans 8:9-16")
      const startRef = formatVerseReference(verseId);
      const parsedEnd = VerseIdHelper.parse(endVerseId);
      return `${startRef}-${parsedEnd.verse}`;
    }
    return formatVerseReference(verseId);
  };

  return (
    <PopupPortal>
    <div
      ref={tooltipRef}
      className={`z-50 rounded-lg shadow-xl p-4${showRedLetter === false ? ' no-red-letter' : ''}`}
      style={{
        ...popupStyle,
        backgroundColor: 'var(--theme-bg-primary)',
        border: '1px solid var(--theme-border-primary)',
        color: 'var(--theme-text-primary)',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onClose}
    >
      {/* Header with reference, and the explicit navigation affordance */}
      <div
        className="flex items-center justify-between gap-2 font-semibold text-accent mb-2 pb-2"
        style={{ borderBottom: '1px solid var(--theme-border-primary)' }}
      >
        <span>{getReference()}</span>
        {onGoToVerse && (
          <button
            type="button"
            className="text-xs font-medium px-2 py-0.5 rounded hover:bg-hover shrink-0"
            style={{ color: 'var(--theme-accent-primary)' }}
            onClick={onGoToVerse}
          >
            {t('versePreviewTooltip.goToVerse')} &rarr;
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>{t('versePreviewTooltip.loading')}</div>
      ) : error ? (
        <div className="text-danger text-sm">{error}</div>
      ) : (
        <div ref={scrollContainerRef} className="relative text-sm space-y-1 max-h-64 overflow-y-auto">
          {verses.map((verse) => {
            // KAN-34: For ranges, highlight all verses in the range; for single, highlight just the target
            const isTargetVerse = isRange
              ? (verse.verse_id >= verseId && (endVerseId ?? verseId) >= verse.verse_id)
              : verse.verse_id === verseId;
            const isFirstTarget = verse.verse_id === verseId;
            return (
              <div
                key={verse.verse_id}
                ref={isFirstTarget ? targetVerseRef : null}
                className={`${isTargetVerse ? 'font-medium' : ''} py-1`}
                style={{
                  backgroundColor: isTargetVerse ? 'var(--theme-accent-bg, rgba(59, 130, 246, 0.1))' : 'transparent',
                  color: isTargetVerse ? 'var(--theme-text-primary)' : 'var(--theme-text-secondary)',
                }}
              >
                <span className="text-xs font-bold me-1 bidi-isolate" style={{ color: 'var(--theme-text-secondary)' }}>
                  {verse.verse}
                </span>
                {/*
                  `text_html` (not `text`): the raw column is unformatted
                  module markup, so previewing it dropped the Words of Christ
                  and divine-name spans `formatVerseText` emits - the popup
                  rendered in flat black next to a red-letter Bible pane.
                  `text` remains the fallback for a module whose row carries
                  no formatted variant.
                */}
                <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(verse.text_html || verse.text) }} />
              </div>
            );
          })}
        </div>
      )}

      {/* Footer hint - only when the consumer supplied one that is true of it */}
      {hint && (
        <div className="text-xs mt-2 pt-2" style={{ color: 'var(--theme-text-secondary)', borderTop: '1px solid var(--theme-border-primary)' }}>
          {hint}
        </div>
      )}
    </div>
    </PopupPortal>
  );
};

export default VersePreviewTooltip;
