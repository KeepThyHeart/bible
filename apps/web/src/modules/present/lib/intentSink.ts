/**
 * Where an interactive viewer's intents go.
 *
 * The viewer never decides what its own gestures *do* to a session. It turns a
 * double-click or a tap into a `PresentIntent` and hands it to an `IntentSink`;
 * whoever mounted it decides where that goes. There are two mounts:
 *
 *  - **The presenter's preview** (an iframe, `?interactive=1`): the sink posts
 *    the intent to the parent page, which validates it and calls
 *    `presentStore.send` -- exactly as if the presenter had pressed a button.
 *    The iframe holds no control token and does not need one.
 *  - **The solo viewer** (`/present/solo`): the sink is a local reducer in the
 *    same page. No window boundary, so no message at all.
 *
 * The interaction code in `interaction/` is identical for both; only the sink
 * differs, which is the whole point of the indirection.
 */

import type { PresentIntent, PresentIntentType } from './protocol';
import { validateIntent } from './reducer';

export type IntentSink = (intent: PresentIntent) => void;

// ---------------------------------------------------------------------------
// The message envelope (viewer iframe -> parent page)
// ---------------------------------------------------------------------------

/** Tags every message this module sends, so a page can ignore anyone else's `postMessage` traffic. */
export const VIEWER_MESSAGE_SOURCE = 'kth-present-viewer';
export const VIEWER_MESSAGE_VERSION = 1;

export interface ViewerIntentMessage {
  source: typeof VIEWER_MESSAGE_SOURCE;
  version: typeof VIEWER_MESSAGE_VERSION;
  kind: 'intent';
  intent: PresentIntent;
}

/**
 * The intents a viewer's pointer layer can produce, and therefore the only
 * ones the parent accepts from it by default. The frame shares the parent's
 * origin (it has to, for its EventSource), so this is not a security boundary
 * -- but a viewer has no business ending a session or changing the theme, and
 * refusing anything else means a bug in the frame cannot either.
 */
export const VIEWER_INTENT_TYPES: ReadonlySet<PresentIntentType> = new Set<PresentIntentType>([
  'addHighlight',
  'removeHighlight',
  'clearHighlights',
  'goTo',
]);

/**
 * A key pressed while the preview frame has focus, passed up unhandled.
 *
 * Clicking into the preview gives the frame keyboard focus, and from then on
 * the presenter's own shortcuts (the clicker, arrows, `.`, `/`) would be
 * listening on a window that no longer receives keys -- in the middle of a
 * service, after a double-click on a word. So the frame hands back every key
 * it did not use itself, and the parent replays it.
 */
export interface ViewerKeyMessage {
  source: typeof VIEWER_MESSAGE_SOURCE;
  version: typeof VIEWER_MESSAGE_VERSION;
  kind: 'key';
  type: 'keydown' | 'keyup';
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
}

export type ViewerKeyInit = Omit<ViewerKeyMessage, 'source' | 'version' | 'kind'>;

export function viewerKeyMessage(event: Pick<KeyboardEvent, 'type' | 'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat'>): ViewerKeyMessage {
  return {
    source: VIEWER_MESSAGE_SOURCE,
    version: VIEWER_MESSAGE_VERSION,
    kind: 'key',
    type: event.type === 'keyup' ? 'keyup' : 'keydown',
    key: event.key,
    code: event.code,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    repeat: event.repeat,
  };
}

/** The key inside a received message, or null for anything else. */
export function parseViewerKeyMessage(data: unknown): ViewerKeyInit | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Partial<ViewerKeyMessage>;
  if (m.source !== VIEWER_MESSAGE_SOURCE || m.version !== VIEWER_MESSAGE_VERSION || m.kind !== 'key') return null;
  if (m.type !== 'keydown' && m.type !== 'keyup') return null;
  if (typeof m.key !== 'string' || m.key.length > 32 || typeof m.code !== 'string' || m.code.length > 32) return null;
  const flag = (v: unknown): boolean => v === true;
  return {
    type: m.type, key: m.key, code: m.code,
    shiftKey: flag(m.shiftKey), ctrlKey: flag(m.ctrlKey), altKey: flag(m.altKey), metaKey: flag(m.metaKey),
    repeat: flag(m.repeat),
  };
}

/**
 * The frame's half of key forwarding: post every key this page did not handle
 * itself (did not `preventDefault`) to `target`. Returns the unsubscribe.
 *
 * The check waits a microtask so it runs after every listener on this page
 * has had its turn, whatever order they were registered in.
 */
export function forwardUnhandledKeys(target: Window, targetOrigin: string = window.location.origin): () => void {
  const onKey = (event: KeyboardEvent): void => {
    queueMicrotask(() => {
      if (!event.defaultPrevented) target.postMessage(viewerKeyMessage(event), targetOrigin);
    });
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
  };
}

export function viewerIntentMessage(intent: PresentIntent): ViewerIntentMessage {
  return { source: VIEWER_MESSAGE_SOURCE, version: VIEWER_MESSAGE_VERSION, kind: 'intent', intent };
}

/**
 * The intent inside a received message, or null for anything that is not a
 * well-formed viewer message carrying an allowed, valid intent.
 *
 * The intent goes through the server's own `validateIntent`, so the parent
 * never forwards something the server would reject (or, worse, something the
 * same-machine transport would apply locally before the server rejected it).
 */
export function parseViewerMessage(
  data: unknown,
  allowed: ReadonlySet<PresentIntentType> = VIEWER_INTENT_TYPES,
): PresentIntent | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Partial<ViewerIntentMessage>;
  if (message.source !== VIEWER_MESSAGE_SOURCE) return null;
  if (message.version !== VIEWER_MESSAGE_VERSION) return null;
  if (message.kind !== 'intent') return null;
  const intent = validateIntent(message.intent);
  if (!intent || !allowed.has(intent.type)) return null;
  return intent;
}

/**
 * Whether a `message` event came from this particular frame, on the expected
 * origin. Both checks: the origin alone would accept any same-origin window
 * (another tab's viewer opened with `window.open`, say), and the source alone
 * would accept the frame after it navigated somewhere else.
 */
export function isFromFrame(
  event: Pick<MessageEvent, 'origin' | 'source'>,
  frameWindow: Window | null,
  expectedOrigin: string,
): boolean {
  return frameWindow !== null && event.source === frameWindow && event.origin === expectedOrigin;
}

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

/**
 * A sink that posts to the page embedding this one. Null when there is no such
 * page -- the viewer opened as a top-level tab with `?interactive=1` typed onto
 * the address has nobody to talk to, and stays a plain viewer.
 *
 * `targetOrigin` is this page's own origin, never `'*'`: if the frame were
 * somehow embedded by a foreign page, the intents simply go nowhere.
 */
export function createPostMessageSink(
  target: Window | null = typeof window !== 'undefined' && window.parent !== window ? window.parent : null,
  targetOrigin: string = typeof window !== 'undefined' ? window.location.origin : '',
): IntentSink | null {
  if (!target || !targetOrigin) return null;
  return intent => target.postMessage(viewerIntentMessage(intent), targetOrigin);
}

/**
 * The parent's half: forward intents posted by `iframe`'s viewer to `onIntent`.
 * Returns the unsubscribe function.
 *
 * `iframe.contentWindow` is read per message rather than once, because it is
 * null until the frame is attached and a different object after a reload.
 *
 * Keys the frame passes up (see `ViewerKeyMessage`) are replayed as keyboard
 * events on this document's body, where they bubble to the same `window`
 * listeners a real key press reaches. `replayKeys: false` turns that off.
 */
export function listenForViewerIntents(
  iframe: HTMLIFrameElement,
  onIntent: IntentSink,
  options: { origin?: string; allowed?: ReadonlySet<PresentIntentType>; replayKeys?: boolean } = {},
): () => void {
  const origin = options.origin ?? window.location.origin;
  const replayKeys = options.replayKeys ?? true;
  const onMessage = (event: MessageEvent): void => {
    if (!isFromFrame(event, iframe.contentWindow, origin)) return;
    const intent = parseViewerMessage(event.data, options.allowed);
    if (intent) {
      onIntent(intent);
      return;
    }
    const key = replayKeys ? parseViewerKeyMessage(event.data) : null;
    if (key) {
      const { type, ...init } = key;
      (document.body ?? document).dispatchEvent(new KeyboardEvent(type, { ...init, bubbles: true, cancelable: true }));
    }
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
