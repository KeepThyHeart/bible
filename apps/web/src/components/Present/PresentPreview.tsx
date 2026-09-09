import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * The wall, in miniature: the real projection viewer in an iframe.
 *
 * Two decisions are doing the work here.
 *
 * **It is the viewer, not a drawing of it.** One rendering path means the
 * preview cannot drift from the screen in the room. A separate "preview
 * renderer" would be a second implementation of auto-fit typography, and the
 * day it disagreed with the real one would be a day in front of a congregation.
 *
 * **It is an iframe, not a scaled div.** The viewer sizes its text in viewport
 * units, deliberately, so that one font setting reads correctly on a television
 * across a hall. Rendered inside a pane of this app, `vh` would measure the
 * browser window and the preview would confidently show text at the wrong size
 * -- lying about the one thing a preview exists to answer. An iframe has its
 * own viewport; a CSS transform then scales the whole thing down without
 * touching what it thinks its dimensions are.
 *
 * The nominal size is 16:9 because that is what a television is. The protocol
 * carries no viewport report from the viewer, on purpose -- it carries intents,
 * not geometry -- so an unusual screen will be slightly mis-framed here. That
 * is a preview being approximate, not a wall being wrong.
 */

const NOMINAL_WIDTH = 1280;
const NOMINAL_HEIGHT = 720;

export function PresentPreview(props: { joinCode: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = (): void => setScale(box.clientWidth / NOMINAL_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div class="present-preview" ref={boxRef}>
      <iframe
        class="present-preview__frame"
        // `preview=1` keeps this out of the viewer count. Without it the
        // presenter would see one viewer and believe the television was on.
        src={`/present/v/${encodeURIComponent(props.joinCode)}?preview=1`}
        title="Screen preview"
        // `allow-same-origin` is required -- the viewer opens an EventSource
        // back to this origin, and an opaque origin would make that a
        // cross-origin request. Paired with `allow-scripts` it does not isolate
        // the frame from this page, and is not claimed to: what it still denies
        // is top-level navigation, popups, forms and downloads, none of which
        // the viewer does. Defence in depth on a page that holds a control
        // token, not a boundary to rely on.
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: `${NOMINAL_WIDTH}px`,
          height: `${NOMINAL_HEIGHT}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          // Until the first measurement the frame would flash at full size.
          visibility: scale > 0 ? 'visible' : 'hidden',
        }}
      />
    </div>
  );
}
