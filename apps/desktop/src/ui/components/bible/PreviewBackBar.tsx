/**
 * "<- Back to John 3:16" - the way home from a preview.
 *
 * Raised only when following a link took the reader out of the chapter they
 * were in. Within a chapter the verse they came from is still on screen, so a
 * bar offering to take them back to it would be noise.
 *
 * It fades itself out after half a minute. The bar is an offer, not a mode:
 * a reader who has moved on and started reading where they landed should not
 * keep being told about a verse they have finished with. Dismissing it - by
 * the x or by the timer - hides the bar but leaves the preview mark on the
 * verse, because that mark is still telling the truth about which verse the
 * study panes are *not* on.
 *
 * Modelled on the web app's `BackBar` (`apps/web/src/components/
 * BiblePane/BackBar.tsx`), including the 30-second life and the 500ms fade.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { formatVerseReference } from '../../utils/verseReference';

/** How long the bar stays before it starts fading. */
const VISIBLE_MS = 30_000;
/** Length of the fade, after which the bar is dismissed for real. */
const FADE_MS = 500;

export interface PreviewBackBarProps {
  /** The verse to return to. The bar is not rendered without one. */
  verseId: number | null;
  onBack: () => void;
  onDismiss: () => void;
}

const PreviewBackBar: React.FC<PreviewBackBarProps> = ({ verseId, onBack, onDismiss }) => {
  const { t } = useI18n();
  const [fading, setFading] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    // Clear on every change of target: following a second link restarts the
    // clock rather than inheriting the remainder of the first one's.
    timers.current.forEach(id => window.clearTimeout(id));
    timers.current = [];
    setFading(false);
    if (verseId === null) return undefined;

    timers.current.push(window.setTimeout(() => {
      setFading(true);
      timers.current.push(window.setTimeout(onDismiss, FADE_MS));
    }, VISIBLE_MS));

    return () => {
      timers.current.forEach(id => window.clearTimeout(id));
      timers.current = [];
    };
  }, [verseId, onDismiss]);

  if (verseId === null) return null;

  return (
    <div
      data-testid="preview-back-bar"
      className="flex items-center gap-2 px-3 py-1 text-xs border-b border-border-primary flex-shrink-0"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--theme-accent-primary) 8%, var(--theme-bg-secondary))',
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      <button
        type="button"
        data-testid="preview-back-bar-back"
        onClick={onBack}
        className="flex items-center gap-1.5 text-accent hover:underline"
      >
        <span aria-hidden="true">&larr;</span>
        {t('biblePane.backToVerse', { reference: formatVerseReference(verseId), })}
      </button>

      <button
        type="button"
        data-testid="preview-back-bar-dismiss"
        onClick={onDismiss}
        className="ms-auto text-text-muted hover:text-text-primary px-1"
        title={t('ui.suggestionBanner.dismiss')}
        aria-label={t('ui.suggestionBanner.dismiss')}
      >
        &times;
      </button>
    </div>
  );
};

export default PreviewBackBar;
