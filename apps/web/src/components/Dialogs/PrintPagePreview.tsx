/**
 * A live, scaled picture of the printed page: the very document Print sends, in a sandboxed iframe.
 *
 * No sandbox permissions (no scripts, no same-origin) and the document carries the print CSP. The iframe
 * is the page's content area (US Letter minus 2 cm page margins) scaled to the available width inside a
 * white "paper" that supplies the margins. Only the first page is shown.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  PRINT_PREVIEW_PAGE_HEIGHT_PX,
  PRINT_PREVIEW_PAGE_PADDING_PX,
  PRINT_PREVIEW_PAGE_WIDTH_PX,
} from '@bible/core/browser';

const CONTENT_WIDTH = PRINT_PREVIEW_PAGE_WIDTH_PX - 2 * PRINT_PREVIEW_PAGE_PADDING_PX;
const CONTENT_HEIGHT = PRINT_PREVIEW_PAGE_HEIGHT_PX - 2 * PRINT_PREVIEW_PAGE_PADDING_PX;

export function PrintPagePreview({ html, label }: { html: string; label: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const update = (): void => {
      const w = host.clientWidth;
      if (w > 0) setScale(Math.min(1, w / PRINT_PREVIEW_PAGE_WIDTH_PX));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={hostRef} data-testid="print-page-preview" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          width: `${PRINT_PREVIEW_PAGE_WIDTH_PX * scale}px`,
          height: `${PRINT_PREVIEW_PAGE_HEIGHT_PX * scale}px`,
          overflow: 'hidden',
          border: '1px solid #ccc',
          background: '#fff',
        }}
      >
        <div
          style={{
            width: `${PRINT_PREVIEW_PAGE_WIDTH_PX}px`,
            height: `${PRINT_PREVIEW_PAGE_HEIGHT_PX}px`,
            padding: `${PRINT_PREVIEW_PAGE_PADDING_PX}px`,
            boxSizing: 'border-box',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            background: '#fff',
          }}
        >
          <iframe
            title={label}
            sandbox=""
            srcdoc={html}
            data-testid="print-page-preview-frame"
            style={{ width: `${CONTENT_WIDTH}px`, height: `${CONTENT_HEIGHT}px`, border: '0', display: 'block', background: '#fff' }}
          />
        </div>
      </div>
    </div>
  );
}
