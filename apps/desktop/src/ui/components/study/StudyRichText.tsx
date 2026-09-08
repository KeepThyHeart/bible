import React, { useMemo, useRef } from 'react';
import VersePreviewTooltip from '../VersePreviewTooltip';
import { useScriptureTooltip } from '../../hooks/useScriptureTooltip';
import { reprocessCommentaryLinks } from '../../utils/commentaryLinkProcessor';
import { sanitizeHtml } from '../../utils/sanitize';
import { markdownToHtml, looksLikeMarkdown } from './markdown';
import { VerseIdHelper } from '@bible/core';
import { previewVerseInPrimary } from '../../stores/crossStoreBridge';
import { useI18n } from '../../contexts/useI18n';

export interface StudyRichTextProps {
  /** Raw module content - HTML for most modules, Markdown for some. */
  content: string;
  /** Verse the content belongs to; supplies the book for bare "3:16" links. */
  verseId: number;
  className?: string;
  /** Forwarded to the rendered region for the provenance notice. */
  'aria-describedby'?: string;
}

/**
 * Module prose for the Study pane: Markdown or HTML in, formatted and linked
 * scripture out.
 *
 * The pipeline is fixed and each stage depends on the previous one's escaping
 * contract (see `markdown.ts`):
 *
 *  1. `markdownToHtml` when the content is Markdown - the bundled SYNTHESIS
 *     digest ships Markdown, which without this step would reach the reader
 *     as literal `====` rules and asterisks. The commentary IPC surface does
 *     not carry the module's declared `content_format`, so the format is
 *     detected from the text.
 *  2. `reprocessCommentaryLinks` turns scripture references into links and
 *     HTML-escapes every text node while it does so.
 *  3. `sanitizeHtml` (DOMPurify) is the backstop before the markup reaches the
 *     DOM. Module content is data from a file on disk, not something the app
 *     authored, so it never goes into `dangerouslySetInnerHTML` unsanitized -
 *     the web app renders `marked` output directly, which the desktop
 *     deliberately does not copy.
 */
const StudyRichText: React.FC<StudyRichTextProps> = ({
  content,
  verseId,
  className = '',
  'aria-describedby': describedBy,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  // Scripture links inside study prose preview rather than select - see
  // `stores/bible/slices/previewSlice.ts`.
  const navigateToVerse = previewVerseInPrimary;

  const contextBookNumber = useMemo(() => VerseIdHelper.parse(verseId).bookNumber, [verseId]);

  const html = useMemo(() => {
    if (!content) return '';
    const asHtml = looksLikeMarkdown(content) ? markdownToHtml(content) : content;
    return sanitizeHtml(
      reprocessCommentaryLinks(asHtml, contextBookNumber)
        .replace(/^(\s|<br\s*\/?>|<p>\s*<\/p>|&nbsp;)+/i, '')
        .replace(/(\s|<br\s*\/?>|<p>\s*<\/p>|&nbsp;)+$/i, '')
        .replace(/^<p>\s*/i, '<p>')
    );
  }, [content, contextBookNumber]);

  const { tooltipState, closeTooltip, tooltipMouseEnter } = useScriptureTooltip(contentRef, [html]);

  return (
    <>
      {/* `prose` is a CHILD of the pane wrapper, never the same element.
          @tailwindcss/typography declares font-size and line-height directly
          on `.prose`; on the same element that beats the pane's own inherited
          font settings outright (the Fonts preferences and the Global Font
          Scale silently do nothing), and the outcome depended on emitted
          source order rather than on anything deliberate. Nested, the pane
          wrapper sizes the text and `globals.css`'s
          `.pane-content-commentary .prose { font-size: inherit }` keeps the
          plugin from taking it back. Nesting also makes the existing
          `.pane-content-commentary .prose a` link styling apply here, which
          a same-element `prose` could never match. */}
      <div className={`pane-content-commentary ${className}`.trim()}>
        <div
          ref={contentRef}
          className="prose"
          aria-describedby={describedBy}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
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
            navigateToVerse(targetVerseId);
          }}
          hint={t('versePreviewTooltip.hintClick')}
        />
      )}
    </>
  );
};

export default StudyRichText;
