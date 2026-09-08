import React, { useEffect, useRef, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { previewVerseInPrimary } from '../../../stores/crossStoreBridge';
import VersePreviewTooltip from '../../VersePreviewTooltip';
import { reprocessCommentaryLinks } from '../../../utils/commentaryLinkProcessor';
import { useI18n } from '../../../contexts/useI18n';

interface NoteViewerProps {
  content: string;
  onEdit?: () => void;  // Optional - not currently used but kept for future use
}

const NoteViewer: React.FC<NoteViewerProps> = ({ content }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  // A reference in a note is a citation the reader is checking, so it
  // previews - see `stores/bible/slices/previewSlice.ts`.
  const navigateToVerse = previewVerseInPrimary;

  // Verse preview tooltip state
  const [tooltip, setTooltip] = React.useState<{
    visible: boolean;
    verseId: number;
    position: { x: number; y: number };
  }>({
    visible: false,
    verseId: 0,
    position: { x: 0, y: 0 }
  });
  const tooltipTimeoutRef = useRef<number | null>(null);

  // Process content: auto-link verse references and sanitize HTML
  const processedContent = useMemo(() => {
    // First, auto-link any verse references in the content (no context book for user notes)
    const linkedContent = reprocessCommentaryLinks(content);
    // Then sanitize the HTML
    return DOMPurify.sanitize(linkedContent, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'mark', 'a', 'ul', 'ol', 'li', 'span'],
      ALLOWED_ATTR: ['class', 'data-verse-id', 'href', 'style', 'data-color'],
    });
  }, [content]);

  // Handle click on verse links (supports both data-verse-id and scripture-link with href)
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    // Helper to extract verse ID from a link element
    const getVerseIdFromLink = (link: Element): number | null => {
      // First try data-verse-id attribute
      const dataVerseId = link.getAttribute('data-verse-id');
      if (dataVerseId) {
        const id = parseInt(dataVerseId, 10);
        return isNaN(id) ? null : id;
      }
      // Then try href="#verse-{id}" format (from reprocessCommentaryLinks)
      const href = link.getAttribute('href');
      if (href && href.startsWith('#verse-')) {
        const idPart = href.replace('#verse-', '').split('-')[0]; // Handle ranges like #verse-123-456
        const id = parseInt(idPart, 10);
        return isNaN(id) ? null : id;
      }
      return null;
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const verseLink = target.closest('.verse-link, .scripture-link, a[data-verse-id], a[href^="#verse-"]');

      if (verseLink) {
        e.preventDefault();
        const verseId = getVerseIdFromLink(verseLink);
        if (verseId) {
          navigateToVerse(verseId);
        }
      }
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const verseLink = target.closest('.verse-link, .scripture-link, a[data-verse-id], a[href^="#verse-"]');

      if (verseLink) {
        // Clear any pending hide timeout
        if (tooltipTimeoutRef.current) {
          clearTimeout(tooltipTimeoutRef.current);
        }

        const verseId = getVerseIdFromLink(verseLink);
        if (verseId) {
          // Show tooltip after a short delay
          tooltipTimeoutRef.current = window.setTimeout(() => {
            const rect = verseLink.getBoundingClientRect();
            setTooltip({
              visible: true,
              verseId,
              position: { x: rect.left, y: rect.bottom + 5 }
            });
          }, 300);
        }
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const verseLink = target.closest('.verse-link, .scripture-link, a[data-verse-id], a[href^="#verse-"]');

      if (verseLink) {
        // Clear pending show timeout
        if (tooltipTimeoutRef.current) {
          clearTimeout(tooltipTimeoutRef.current);
        }
        // Hide tooltip after delay (allows moving to tooltip)
        tooltipTimeoutRef.current = window.setTimeout(() => {
          setTooltip(prev => ({ ...prev, visible: false }));
        }, 200);
      }
    };

    container.addEventListener('click', handleClick);
    container.addEventListener('mouseover', handleMouseOver);
    container.addEventListener('mouseout', handleMouseOut);

    return () => {
      container.removeEventListener('click', handleClick);
      container.removeEventListener('mouseover', handleMouseOver);
      container.removeEventListener('mouseout', handleMouseOut);
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, [navigateToVerse]);

  return (
    <div className="h-full flex flex-col">
      {/* Content area */}
      <div
        ref={contentRef}
        className="flex-1 overflow-auto p-4 prose prose-sm max-w-none"
        style={{
          fontFamily: 'Georgia, serif',
          // Follows the Typography section's "Study text" size and the
          // "Global Font Scale" slider, matching NoteEditor.tsx and every
          // other content pane's `.pane-content-*` rule in globals.css - see
          // NoteEditor.tsx's comment for why a literal 16px here would go dead.
          fontSize: 'calc(var(--study-font-size, 16px) * var(--global-font-scale, 1))',
          lineHeight: '1.7'
        }}
      >
        <style>{`
          .verse-link, .scripture-link, a[data-verse-id], a[href^="#verse-"] {
            color: #2563eb;
            text-decoration: underline;
            cursor: pointer;
          }
          .verse-link:hover, .scripture-link:hover, a[data-verse-id]:hover, a[href^="#verse-"]:hover {
            color: #1d4ed8;
          }
          mark[data-color="yellow"], mark[style*="#fef08a"] {
            background-color: #fef08a;
          }
          mark[data-color="green"], mark[style*="#bbf7d0"] {
            background-color: #bbf7d0;
          }
          mark[data-color="blue"], mark[style*="#bfdbfe"] {
            background-color: #bfdbfe;
          }
          mark[data-color="pink"], mark[style*="#fbcfe8"] {
            background-color: #fbcfe8;
          }
          mark[data-color="orange"], mark[style*="#fed7aa"] {
            background-color: #fed7aa;
          }
          /* List formatting */
          ul {
            list-style-type: disc;
            padding-left: 1.5em;
            margin: 0.5em 0;
          }
          ol {
            list-style-type: decimal;
            padding-left: 1.5em;
            margin: 0.5em 0;
          }
          li {
            margin: 0.25em 0;
          }
        `}</style>
        <div dangerouslySetInnerHTML={{ __html: processedContent }} />
      </div>

      {/* Verse preview tooltip */}
      {tooltip.visible && (
        <VersePreviewTooltip
          verseId={tooltip.verseId}
          position={tooltip.position}
          onClose={() => setTooltip(prev => ({ ...prev, visible: false }))}
          onMouseEnter={() => {
            if (tooltipTimeoutRef.current) {
              clearTimeout(tooltipTimeoutRef.current);
            }
          }}
          onGoToVerse={() => {
            const targetVerseId = tooltip.verseId;
            setTooltip(prev => ({ ...prev, visible: false }));
            navigateToVerse(targetVerseId);
          }}
          hint={t('versePreviewTooltip.hintClick')}
        />
      )}
    </div>
  );
};

export default NoteViewer;
