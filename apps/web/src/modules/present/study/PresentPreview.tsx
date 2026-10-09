import { useEffect, useRef, useState } from 'preact/hooks';
import { listenForViewerIntents, type IntentSink } from '../lib/intentSink';
import type { PresentState } from '../lib/protocol';
import { isLocalPreviewHello, localPreviewStateMessage } from '../app/control/localPreviewProtocol';

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
 *
 * **Interactive** (presenter only): the frame is loaded with `interactive=1`,
 * which turns on the viewer's pointer layer, and the intents it posts back are
 * validated here and handed to `onIntent` (the presenter passes
 * `presentStore.send`). Pointer input needs no coordinate mapping: browsers
 * hit-test through the CSS transform, so a click lands on the word drawn under
 * it at any scale.
 *
 * **Local mode** (before going live): with `localState` instead of a join code,
 * the same viewer page runs in the frame with `?local=1` and draws the state
 * posted into it (the Presenter's offline session), so the preview looks and
 * behaves exactly as it will once live.
 */

const NOMINAL_WIDTH = 1280;
const NOMINAL_HEIGHT = 720;

export interface PresentPreviewProps {
  /** The live session's join code. Omit, with `localState`, for the pre-live preview. */
  joinCode?: string;
  /** Pre-live: the local session's state to draw. Ignored when `joinCode` is given. */
  localState?: PresentState | null;
  /** Turn on the viewer's pointer layer (double-click to highlight, etc.). Default false. */
  interactive?: boolean;
  /** Receives the interactive viewer's intents. Ignored unless `interactive`. */
  onIntent?: IntentSink;
}

export function PresentPreview(props: PresentPreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0);
  const interactive = props.interactive === true;
  const isLocal = !props.joinCode;

  // Pre-live: post the state in on every change, and on the frame's request
  // (it may have loaded before this listener ran, or reloaded).
  const localState = useRef<PresentState | null>(props.localState ?? null);
  localState.current = props.localState ?? null;
  const post = (): void => {
    const state = localState.current;
    const target = frameRef.current?.contentWindow;
    if (state && target) target.postMessage(localPreviewStateMessage(state), window.location.origin);
  };
  useEffect(() => { if (isLocal) post(); }, [isLocal, props.localState]);
  useEffect(() => {
    if (!isLocal) return;
    const onMessage = (event: MessageEvent): void => {
      if (event.source === frameRef.current?.contentWindow && event.origin === window.location.origin
        && isLocalPreviewHello(event.data)) post();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isLocal]);

  // Through a ref, so a new callback identity each render does not tear the
  // message listener down and put it back.
  const onIntent = useRef(props.onIntent);
  onIntent.current = props.onIntent;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = (): void => setScale(box.clientWidth / NOMINAL_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!interactive || !frame) return;
    return listenForViewerIntents(frame, intent => onIntent.current?.(intent));
  }, [interactive]);

  // `preview=1` keeps this out of the viewer count. Without it the presenter
  // would see one viewer and believe the television was on.
  const query = (interactive ? '?preview=1&interactive=1' : '?preview=1') + (isLocal ? '&local=1' : '');

  return (
    <div class={`present-preview${interactive ? ' present-preview--interactive' : ''}`} ref={boxRef}>
      <iframe
        ref={frameRef}
        class="present-preview__frame"
        src={`/present/v/${isLocal ? 'local' : encodeURIComponent(props.joinCode!)}${query}`}
        onLoad={isLocal ? post : undefined}
        title="Screen preview"
        // `allow-same-origin` is required -- the viewer opens an EventSource
        // back to this origin, and an opaque origin would make that a
        // cross-origin request. Paired with `allow-scripts` it does not isolate
        // the frame from this page, and is not claimed to: what it still denies
        // is top-level navigation, popups, forms and downloads, none of which
        // the viewer does. Defence in depth on a page that holds a control
        // token, not a boundary to rely on. (It is also why the interactive
        // bridge checks the message's source frame and origin, and accepts
        // only the handful of intents a viewer's gestures can produce.)
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
