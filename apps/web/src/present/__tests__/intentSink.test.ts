import { describe, it, expect, vi } from 'vitest';
import {
  createPostMessageSink, isFromFrame, parseViewerKeyMessage, parseViewerMessage, viewerIntentMessage,
  viewerKeyMessage, VIEWER_MESSAGE_SOURCE,
} from '../intentSink';

const add = { type: 'addHighlight', highlight: { verseIdStart: 43003016, textStart: 2, textEnd: 4 } } as const;

describe('viewer message envelope', () => {
  it('round-trips an allowed intent', () => {
    expect(parseViewerMessage(viewerIntentMessage(add))).toEqual(add);
    expect(parseViewerMessage(viewerIntentMessage({ type: 'goTo', index: 17 }))).toEqual({ type: 'goTo', index: 17 });
    expect(parseViewerMessage(viewerIntentMessage({ type: 'clearHighlights' }))).toEqual({ type: 'clearHighlights' });
  });

  it('ignores other traffic', () => {
    expect(parseViewerMessage(null)).toBeNull();
    expect(parseViewerMessage('hello')).toBeNull();
    expect(parseViewerMessage({ type: 'goTo', index: 3 })).toBeNull();
    expect(parseViewerMessage({ ...viewerIntentMessage(add), source: 'someone-else' })).toBeNull();
    expect(parseViewerMessage({ ...viewerIntentMessage(add), version: 2 })).toBeNull();
    expect(parseViewerMessage({ ...viewerIntentMessage(add), kind: 'state' })).toBeNull();
  });

  it('rejects intents the server would reject', () => {
    const backwards = { type: 'addHighlight', highlight: { verseIdStart: 43003016, textStart: 5, textEnd: 2 } };
    expect(parseViewerMessage({ source: VIEWER_MESSAGE_SOURCE, version: 1, kind: 'intent', intent: backwards })).toBeNull();
    expect(parseViewerMessage({ source: VIEWER_MESSAGE_SOURCE, version: 1, kind: 'intent', intent: { type: 'goTo' } })).toBeNull();
  });

  it('refuses valid intents a viewer has no business sending, unless allowed', () => {
    const end = viewerIntentMessage({ type: 'end' });
    expect(parseViewerMessage(end)).toBeNull();
    expect(parseViewerMessage(viewerIntentMessage({ type: 'setTheme', theme: 'dark' }))).toBeNull();
    expect(parseViewerMessage(end, new Set(['end']))).toEqual({ type: 'end' });
  });
});

describe('key forwarding envelope', () => {
  const down = {
    type: 'keydown', key: 'ArrowRight', code: 'ArrowRight',
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false,
  } as const;

  it('round-trips a key', () => {
    expect(parseViewerKeyMessage(viewerKeyMessage(down))).toEqual(down);
    expect(parseViewerKeyMessage(viewerKeyMessage({ ...down, type: 'keyup', repeat: true })))
      .toEqual({ ...down, type: 'keyup', repeat: true });
  });

  it('rejects anything else, including intent messages', () => {
    expect(parseViewerKeyMessage(viewerIntentMessage(add))).toBeNull();
    expect(parseViewerKeyMessage({ ...viewerKeyMessage(down), type: 'keypress' })).toBeNull();
    expect(parseViewerKeyMessage({ ...viewerKeyMessage(down), key: 'x'.repeat(100) })).toBeNull();
    expect(parseViewerKeyMessage({ ...viewerKeyMessage(down), source: 'other' })).toBeNull();
    expect(parseViewerMessage(viewerKeyMessage(down))).toBeNull();
  });
});

describe('isFromFrame', () => {
  const frame = {} as Window;
  it('needs both the frame and the origin', () => {
    expect(isFromFrame({ source: frame, origin: 'https://a.test' }, frame, 'https://a.test')).toBe(true);
    expect(isFromFrame({ source: frame, origin: 'https://b.test' }, frame, 'https://a.test')).toBe(false);
    expect(isFromFrame({ source: {} as Window, origin: 'https://a.test' }, frame, 'https://a.test')).toBe(false);
    expect(isFromFrame({ source: null, origin: 'https://a.test' }, null, 'https://a.test')).toBe(false);
  });
});

describe('createPostMessageSink', () => {
  it('posts the envelope to the target, on the given origin only', () => {
    const postMessage = vi.fn();
    const sink = createPostMessageSink({ postMessage } as unknown as Window, 'https://a.test');
    sink!(add);
    expect(postMessage).toHaveBeenCalledWith(viewerIntentMessage(add), 'https://a.test');
  });

  it('is null with nobody to post to', () => {
    expect(createPostMessageSink(null, 'https://a.test')).toBeNull();
  });
});
