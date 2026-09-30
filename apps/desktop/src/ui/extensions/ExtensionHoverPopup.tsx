/**
 * The extension hover popup (task 0036, P0.1c; design doc §11.5).
 *
 * Self-contained: reads its own state from `verseHoverPopupStore` and
 * renders nothing when there is no popup open, the same way `ExtensionUiHost`
 * already renders `ExtensionVersePopup` - mount it once, there.
 *
 * Reuses `usePopupPosition` + `PopupPortal` exactly as `VersePreviewTooltip`/
 * `StrongsPreviewTooltip` do (design doc §11.5: "No new positioning
 * primitive... Do not re-solve this").
 */

import React from 'react';
import { usePopupPosition, PopupPortal } from '../hooks/usePopupPosition';
import { useI18n } from '../contexts/useI18n';
import { sanitizeHtml } from '../utils/sanitize';
import { markdownToHtml } from '../components/study/markdown';
import { useVerseHoverPopupStore, type HoverSection } from './verseHoverPopupStore';
import type { Extensions } from '@bible/core';

type HoverContentDto = Extensions.HoverContentDto;

/** Matches `VersePreviewTooltip`/`StrongsPreviewTooltip`'s own fixed width. */
const POPUP_WIDTH = 340;
const ESTIMATED_HEIGHT = 120;

/** Strips `<img>` tags when a markdown section didn't opt in to images (`HoverContentDto.allowImages`). */
function stripImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, '');
}

function renderContent(content: HoverContentDto | 'loading'): React.ReactNode {
  if (content === 'loading') {
    return <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />;
  }
  switch (content.kind) {
    case 'text':
      return <p className="whitespace-pre-wrap">{content.text}</p>;
    case 'markdown': {
      const html = markdownToHtml(content.markdown);
      const safe = sanitizeHtml(content.allowImages ? html : stripImages(html));
      return <div className="prose" dangerouslySetInnerHTML={{ __html: safe }} />;
    }
    case 'iframe':
      // Deferred out of P0.1c (design doc §15: "unless it falls out for
      // free" - a sandboxed iframe inside a popup that closes on mouse-out
      // is its own can of worms). A plain note rather than silently
      // dropping the section, so the author can tell their content didn't
      // vanish for no reason.
      return (
        <p className="text-xs italic" style={{ color: 'var(--theme-text-secondary)' }}>
          This content isn&rsquo;t supported in a hover popup yet.
        </p>
      );
    default:
      return null;
  }
}

function Section({ section, isFirst }: { section: HoverSection; isFirst: boolean }): React.ReactElement {
  const { i18n } = useI18n();
  const title = section.title !== undefined ? i18n.resolve(section.title) : undefined;
  return (
    <div className={isFirst ? '' : 'pt-2 mt-2'} style={isFirst ? undefined : { borderTop: '1px solid var(--theme-border-primary)' }}>
      <div className="text-xs font-medium mb-1" style={{ color: 'var(--theme-text-secondary)' }}>
        {title ?? section.extensionId}
      </div>
      <div className="text-sm">{renderContent(section.content)}</div>
    </div>
  );
}

export const ExtensionHoverPopup: React.FC = () => {
  const popup = useVerseHoverPopupStore((s) => s.popup);
  const cancelClose = useVerseHoverPopupStore((s) => s.cancelClose);
  const scheduleClose = useVerseHoverPopupStore((s) => s.scheduleClose);

  // Hooks must run unconditionally - compute position/style even while
  // `popup` is null (an arbitrary stable point) and just render nothing.
  const { ref, style } = usePopupPosition(popup?.position ?? { x: 0, y: 0 }, {
    width: POPUP_WIDTH,
    estimatedHeight: ESTIMATED_HEIGHT,
  });

  if (!popup) return null;

  return (
    <PopupPortal>
      <div
        ref={ref}
        className="z-50 rounded-lg shadow-xl p-3"
        style={{
          ...style,
          backgroundColor: 'var(--theme-bg-primary)',
          border: '1px solid var(--theme-border-primary)',
          color: 'var(--theme-text-primary)',
        }}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        {popup.sections.map((section, i) => (
          <Section key={section.key} section={section} isFirst={i === 0} />
        ))}
      </div>
    </PopupPortal>
  );
};

export default ExtensionHoverPopup;
