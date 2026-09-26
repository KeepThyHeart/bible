import { createRef, useMemo, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { ExtensionPanelHost } from './ExtensionPanelHost';
import type { ExtensionPanelHostProps } from './ExtensionPanelHost';
import type { BridgeContext, BridgeHandlers, IframeRpcBridge } from '@bible/core/browser';

const CTX: BridgeContext = { extensionId: 'ext.test', panelId: 'p1', panelTypeId: 'pt', grants: [] };
const SANDBOX = 'allow-scripts allow-forms';

/** Give the rendered iframe a fake contentWindow and collect what the host posts to it. */
function fakeWindow(iframe: HTMLIFrameElement) {
  const posted: unknown[] = [];
  const contentWindow = { postMessage: (m: unknown) => posted.push(m) };
  Object.defineProperty(iframe, 'contentWindow', { configurable: true, get: () => contentWindow });
  return { posted, contentWindow };
}

/** Dispatch a `message` event on `window` with an arbitrary `source` (jsdom rejects non-Window sources in the init dict). */
function send(source: unknown, data: unknown) {
  const ev = new MessageEvent('message', { data });
  Object.defineProperty(ev, 'source', { value: source });
  window.dispatchEvent(ev);
}
const request = (method: string, args: unknown[] = [], id = 'req-1') => ({ kind: 'request', id, method, args });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function props(over: Partial<ExtensionPanelHostProps> = {}): ExtensionPanelHostProps {
  return { src: 'ext-ui://ext.test/index.html', sandbox: SANDBOX, title: 'Panel', context: CTX, handlers: {}, ...over };
}
const frame = (container: HTMLElement) => container.querySelector('iframe') as HTMLIFrameElement;

describe('ExtensionPanelHost: rendering', () => {
  it('renders the sandboxed iframe with the given attributes', () => {
    const { container } = render(
      <ExtensionPanelHost {...props({ className: 'app-frame', dataAttributes: { 'data-panel-id': 'p1', 'data-extension-id': 'ext.test' } })} />,
    );
    const f = frame(container);
    expect(f).toHaveAttribute('src', 'ext-ui://ext.test/index.html');
    expect(f).toHaveAttribute('sandbox', SANDBOX);
    expect(f).toHaveAttribute('title', 'Panel');
    expect(f).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(f).toHaveAttribute('data-panel-id', 'p1');
    expect(f).toHaveAttribute('data-extension-id', 'ext.test');
    expect(f).toHaveClass('kth-panel-host__frame');
    expect(f).toHaveClass('app-frame');
  });

  it('shows the loading node and no iframe while src is null', () => {
    const { container } = render(
      <ExtensionPanelHost {...props({ src: null, loading: <span>Loading...</span>, dataAttributes: { 'data-panel-id': 'p1' } })} />,
    );
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(frame(container)).toBeNull();
    expect(container.querySelector('.kth-panel-host__status')).toHaveAttribute('data-panel-id', 'p1');
  });

  it('shows the error as an alert and no iframe; the error wins over src', () => {
    const { container } = render(<ExtensionPanelHost {...props({ error: 'not registered' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('not registered');
    expect(frame(container)).toBeNull();
  });

  it('renders error text as text, never HTML', () => {
    const { container } = render(<ExtensionPanelHost {...props({ error: '<img src=x onerror=alert(1)>' })} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('hands the iframe element to iframeRef (object and callback forms)', () => {
    const ref = createRef<HTMLIFrameElement>();
    const { container, unmount } = render(<ExtensionPanelHost {...props({ iframeRef: ref })} />);
    expect(ref.current).toBe(frame(container));
    unmount();
    expect(ref.current).toBeNull();

    const seen: Array<HTMLIFrameElement | null> = [];
    const r2 = render(<ExtensionPanelHost {...props({ iframeRef: (el) => seen.push(el) })} />);
    expect(seen[0]).toBe(frame(r2.container));
  });
});

describe('ExtensionPanelHost: bridge lifecycle', () => {
  it('answers requests from its own iframe and ignores other windows', async () => {
    const handler = vi.fn((args: readonly unknown[]) => `echo:${String(args[0])}`);
    const { container } = render(<ExtensionPanelHost {...props({ handlers: { 'test.echo': handler } })} />);
    const { posted, contentWindow } = fakeWindow(frame(container));

    send({ postMessage: vi.fn() }, request('test.echo', ['x'], 'evil'));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(posted).toEqual([]);

    send(contentWindow, request('test.echo', ['hi']));
    await flush();
    expect(handler).toHaveBeenCalledWith(['hi'], CTX);
    expect(posted).toEqual([{ kind: 'response', id: 'req-1', result: 'echo:hi' }]);
  });

  it('ignores a message with a null source', async () => {
    const handler = vi.fn();
    const { container } = render(<ExtensionPanelHost {...props({ handlers: { 'test.echo': handler } })} />);
    fakeWindow(frame(container));
    send(null, request('test.echo'));
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('replies with an error for an unknown method', async () => {
    const { container } = render(<ExtensionPanelHost {...props()} />);
    const { posted, contentWindow } = fakeWindow(frame(container));
    send(contentWindow, request('nope'));
    await flush();
    expect(posted).toEqual([
      { kind: 'response', id: 'req-1', error: { code: 'BridgeError', message: 'Unknown iframe bridge method: nope' } },
    ]);
  });

  it('attaches while loading and works once the iframe mounts (lazy target)', async () => {
    const handler = vi.fn(() => 1);
    const handlers: BridgeHandlers = { 'test.one': handler };
    const { container, rerender } = render(<ExtensionPanelHost {...props({ src: null, handlers })} />);
    rerender(<ExtensionPanelHost {...props({ handlers })} />);
    const { posted, contentWindow } = fakeWindow(frame(container));
    send(contentWindow, request('test.one'));
    await flush();
    expect(posted).toEqual([{ kind: 'response', id: 'req-1', result: 1 }]);
  });

  it('reads the context getter per request', async () => {
    let n = 0;
    const seen: string[] = [];
    const handlers: BridgeHandlers = { 'test.who': (_a, ctx) => seen.push(ctx.panelId ?? '') };
    const { container } = render(
      <ExtensionPanelHost {...props({ handlers, context: () => ({ ...CTX, panelId: `p${++n}` }) })} />,
    );
    const { contentWindow } = fakeWindow(frame(container));
    send(contentWindow, request('test.who', [], 'a'));
    send(contentWindow, request('test.who', [], 'b'));
    await flush();
    expect(seen).toEqual(['p1', 'p2']);
  });

  it('denies uikit.* by default even when a handler exists, without calling it', async () => {
    const handler = vi.fn();
    const { container } = render(<ExtensionPanelHost {...props({ handlers: { 'uikit.something': handler } })} />);
    const { posted, contentWindow } = fakeWindow(frame(container));
    send(contentWindow, request('uikit.something'));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(posted[0]).toMatchObject({ kind: 'response', id: 'req-1', error: { code: 'PermissionDeniedError' } });
  });

  it('runs the authorize hook and skips the handler on deny', async () => {
    const handler = vi.fn();
    const authorize = vi.fn(() => ({ ok: false as const, reason: 'no' }));
    const { container } = render(<ExtensionPanelHost {...props({ handlers: { 'test.x': handler }, authorize })} />);
    const { posted, contentWindow } = fakeWindow(frame(container));
    send(contentWindow, request('test.x'));
    await flush();
    expect(authorize).toHaveBeenCalledWith('test.x', CTX);
    expect(handler).not.toHaveBeenCalled();
    expect(posted[0]).toMatchObject({ error: { code: 'PermissionDeniedError', message: 'no' } });
  });

  it('gives onBridge the live bridge, which can emit to the iframe, and null on unmount', async () => {
    const onBridge = vi.fn();
    const { container, unmount } = render(<ExtensionPanelHost {...props({ onBridge })} />);
    expect(onBridge).toHaveBeenCalledTimes(1);
    const bridge = onBridge.mock.calls[0][0] as IframeRpcBridge;
    const { posted } = fakeWindow(frame(container));
    bridge.emit('theme.changed', { mode: 'dark' });
    expect(posted).toEqual([{ kind: 'event', channel: 'theme.changed', payload: { mode: 'dark' } }]);
    unmount();
    expect(onBridge).toHaveBeenCalledTimes(2);
    expect(onBridge).toHaveBeenLastCalledWith(null);
    expect(bridge.isDisposed).toBe(true);
  });

  it('removes its window listener on unmount and answers nothing afterwards', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const handler = vi.fn();
    const { container, unmount } = render(<ExtensionPanelHost {...props({ handlers: { 'test.x': handler } })} />);
    const { posted, contentWindow } = fakeWindow(frame(container));
    const added = add.mock.calls.filter(([type]) => type === 'message');
    expect(added).toHaveLength(1);
    unmount();
    expect(remove.mock.calls.filter(([type, fn]) => type === 'message' && fn === added[0][1])).toHaveLength(1);
    send(contentWindow, request('test.x'));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
    add.mockRestore();
    remove.mockRestore();
  });

  it('keeps ONE bridge across re-renders with stable handlers and recreates it when handlers change', () => {
    const onBridge = vi.fn();
    const a: BridgeHandlers = {};
    const b: BridgeHandlers = {};
    const { rerender } = render(<ExtensionPanelHost {...props({ handlers: a, onBridge })} />);
    rerender(<ExtensionPanelHost {...props({ handlers: a, onBridge, title: 'Other', context: { ...CTX } })} />);
    expect(onBridge).toHaveBeenCalledTimes(1);
    rerender(<ExtensionPanelHost {...props({ handlers: b, onBridge })} />);
    expect(onBridge.mock.calls.map((c) => (c[0] === null ? null : 'bridge'))).toEqual(['bridge', null, 'bridge']);
  });

  it('creates one bridge per mount with a memoized handlers object', () => {
    const onBridge = vi.fn();
    function Wrapper() {
      const [n, setN] = useState(0);
      const handlers = useMemo<BridgeHandlers>(() => ({}), []);
      return (
        <>
          <button onClick={() => setN(n + 1)}>bump {n}</button>
          <ExtensionPanelHost {...props({ handlers, onBridge })} />
        </>
      );
    }
    render(<Wrapper />);
    act(() => screen.getByRole('button').click());
    expect(onBridge.mock.calls.filter(([b]) => b !== null)).toHaveLength(1);
  });
});
