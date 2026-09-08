import React, { useRef, useMemo, useEffect } from 'react';
import { reprocessCommentaryLinks } from '../../utils/commentaryLinkProcessor';
import { useScriptureTooltip } from '../../hooks/useScriptureTooltip';
import VersePreviewTooltip from '../VersePreviewTooltip';
import type { CommentaryEntry } from '../../stores/useCommentaryStore';
import { sanitizeHtml } from '../../utils/sanitize';
import { useBibleStore, DEFAULT_PANEL_ID } from '../../stores/useBibleStore';
import { previewVerseInPrimary } from '../../stores/crossStoreBridge';
import { VerseIdHelper } from '@bible/core';
import { looksLikeMarkdown, markdownToHtml } from '../study/markdown';
import { useI18n } from '../../contexts/useI18n';

/**
 * Props for a single commentary entry display.
 */
interface CommentaryEntryViewProps {
  entry: CommentaryEntry;
  showDivider: boolean;
  contextBookNumber?: number;
  showLevelBadge?: boolean;
}

/**
 * Renders a single commentary entry with Scripture reference link handling,
 * hover tooltips, and content processing.
 *
 * Shared between CommentaryPane (multi-tab) and CommentarySinglePanel (standalone).
 */
const CommentaryEntryView: React.FC<CommentaryEntryViewProps> = ({ entry, showDivider, contextBookNumber, showLevelBadge = false }) => {
  const { t } = useI18n();
  const contentRef = useRef<HTMLDivElement>(null);

  const processedContent = useMemo(() => {
    // Some commentary modules (e.g. the bundled SYNTHESIS digest) ship
    // Markdown rather than HTML. The commentary IPC surface does not carry
    // the module's declared `content_format`, so the format is sniffed from
    // the text itself - same detection used by the Study pane's
    // `StudyRichText`. Rendered raw, Markdown reaches the reader as literal
    // `====` rules and asterisks.
    const asHtml = looksLikeMarkdown(entry.content) ? markdownToHtml(entry.content) : entry.content;
    const linkedContent = reprocessCommentaryLinks(asHtml, contextBookNumber);
    return linkedContent
      .replace(/^(\s|<br\s*\/?>|<p>\s*<\/p>|&nbsp;)+/i, '')
      .replace(/(\s|<br\s*\/?>|<p>\s*<\/p>|&nbsp;)+$/i, '')
      .replace(/^<p>\s*/i, '<p>');
  }, [entry.content, contextBookNumber]);

  const { tooltipState, closeTooltip, tooltipMouseEnter } = useScriptureTooltip(contentRef, [processedContent]);

  // Ctrl/Cmd+Click on scripture links opens the reference in a NEW Bible tab
  // instead of navigating the current tab. Attached in the capture phase so it
  // runs before the hook's handler (which calls navigateToVerseInPrimary).
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const handleCaptureClick = (e: MouseEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement;
      if (target.tagName !== 'A') return;
      const href = target.getAttribute('href');
      if (!href || !href.startsWith('#verse-')) return;
      const verseIdStr = href.replace('#verse-', '').split('-')[0];
      const verseId = parseInt(verseIdStr, 10);
      if (isNaN(verseId)) return;
      e.preventDefault();
      e.stopPropagation();
      const parsed = VerseIdHelper.parse(verseId);
      // Open the reference as its own Bible panel, docked beside the panel it
      // came from, rather than replacing what the user is currently reading.
      const state = useBibleStore.getState(); // allow-getstate: event handler - imperative store access
      let targetPanelId = DEFAULT_PANEL_ID;
      if (!state.panels.has(DEFAULT_PANEL_ID)) {
        const firstKey = state.panels.keys().next().value;
        if (firstKey) targetPanelId = firstKey;
      }
      void state.openPassageInNewPanel(parsed.bookNumber, parsed.chapter, parsed.verse, targetPanelId);
    };
    element.addEventListener('click', handleCaptureClick, true);
    return () => {
      element.removeEventListener('click', handleCaptureClick, true);
    };
  }, [processedContent]);

  return (
    <div className="mb-lg" data-testid="commentary-entry">
      {showLevelBadge && (
        <div className="inline-block px-sm py-xs bg-accent/10 text-accent text-xs rounded mb-sm">
          {entry.entry_level.charAt(0).toUpperCase() + entry.entry_level.slice(1)} Level
        </div>
      )}
      <div
        ref={contentRef}
        className="prose prose-lg max-w-none"
        data-testid="commentary-entry-content"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(processedContent) }}
      />
      {showDivider && <hr className="mt-lg border-border" />}
      {tooltipState.visible && (
        <VersePreviewTooltip
          verseId={tooltipState.verseId}
          endVerseId={tooltipState.endVerseId}
          position={tooltipState.position}
          onClose={closeTooltip}
          onMouseEnter={tooltipMouseEnter}
          onGoToVerse={() => {
            const targetVerseId = tooltipState.verseId;
            closeTooltip();
            // A citation inside a commentary entry is a glance: the reader
            // is checking what it says, not moving their study to it. Preview
            // leaves this pane - and every other one - where it was.
            previewVerseInPrimary(targetVerseId);
          }}
          hint={t('versePreviewTooltip.hintClickCtrlClick')}
        />
      )}
    </div>
  );
};

export default CommentaryEntryView;
export type { CommentaryEntryViewProps };
