/**
 * A live, scaled picture of the printed page: the very document Print sends, shown in a sandboxed iframe.
 *
 * The iframe has no sandbox permissions (no scripts, no same-origin) and the document carries the same CSP
 * as the print window. It is sized as the page's content area (US Letter minus the 2 cm page margins) and
 * scaled to fit the available width, inside a white "paper" that supplies the margins. Only the first page
 * is shown; the printed result paginates itself.
 */
import { useEffect, useRef, useState } from 'react';
import {
  PRINT_PREVIEW_PAGE_HEIGHT_PX,
  PRINT_PREVIEW_PAGE_PADDING_PX,
  PRINT_PREVIEW_PAGE_WIDTH_PX,
} from '@bible/core';

interface PrintPagePreviewProps {
  html: string;
  label: string;
}

const CONTENT_WIDTH = PRINT_PREVIEW_PAGE_WIDTH_PX - 2 * PRINT_PREVIEW_PAGE_PADDING_PX;
const CONTENT_HEIGHT = PRINT_PREVIEW_PAGE_HEIGHT_PX - 2 * PRINT_PREVIEW_PAGE_PADDING_PX;

export default function PrintPagePreview({ html, label }: PrintPagePreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const update = () => {
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
    <div ref={hostRef} data-testid="print-page-preview" className="w-full flex justify-center">
      <div
        style={{
          width: PRINT_PREVIEW_PAGE_WIDTH_PX * scale,
          height: PRINT_PREVIEW_PAGE_HEIGHT_PX * scale,
          overflow: 'hidden',
        }}
        className="shadow border border-border bg-white"
      >
        <div
          style={{
            width: PRINT_PREVIEW_PAGE_WIDTH_PX,
            height: PRINT_PREVIEW_PAGE_HEIGHT_PX,
            padding: PRINT_PREVIEW_PAGE_PADDING_PX,
            boxSizing: 'border-box',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            background: '#fff',
          }}
        >
          <iframe
            title={label}
            sandbox=""
            srcDoc={html}
            data-testid="print-page-preview-frame"
            style={{ width: CONTENT_WIDTH, height: CONTENT_HEIGHT, border: 0, display: 'block', background: '#fff' }}
          />
        </div>
      </div>
    </div>
  );
}
