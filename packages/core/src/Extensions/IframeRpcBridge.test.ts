import { describe, expect, it, vi } from 'vitest';

import {
  IframeRpcBridge,
  authorizeBridgeMethod,
  type BridgeContext,
  type BridgeHandlers,
  type BridgeMessageEvent,
  type IframeRpcBridgeOptions,
} from './IframeRpcBridge';
import { ExtensionApiError } from './ExtensionApiErrors';
import type { UiKitComponentSpec } from './UiKit';

// --- Fakes ------------------------------------------------------------------

class FakeWindow {
  listeners = new Set<(e: BridgeMessageEvent) => void>();
  addEventListener(_t: 'message', l: (e: BridgeMessageEvent) => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_t: 'message', l: (e: BridgeMessageEvent) => void): void {
    this.listeners.delete(l);
  }
  dispatch(e: BridgeMessageEvent): void {
    for (const l of [...this.listeners]) l(e);
  }
}

function makeTarget() {
  const posted: Array<{ message: unknown; origin: string }> = [];
  const target = {
    postMessage: (message: unknown, origin: string) => {
      posted.push({ message, origin });
    },
  };
  return { target, posted, messages: () => posted.map((p) => p.message) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const CTX: BridgeContext = { extensionId: 'ext.test.alpha', panelId: 'p1', panelTypeId: 't1', grants: [] };

function setup(over: Partial<IframeRpcBridgeOptions> & { handlers?: BridgeHandlers } = {}) {
  const win = new FakeWindow();
  const t = makeTarget();
  const handlers: BridgeHandlers = over.handlers ?? {};
  const bridge = new IframeRpcBridge({
    context: CTX,
    hostWindow: win,
    getTarget: () => t.target,
    ...over,
    handlers,
  });
  bridge.attach();
  const send = (method: string, args: unknown[] = [], id = 'req-1', extra: Record<string, unknown> = {}) =>
    win.dispatch({ data: { kind: 'request', id, method, args, ...extra }, source: t.target });
  return { win, t, bridge, send };
}

const reply = (msgs: unknown[], id = 'req-1') =>
  msgs.find((m) => (m as { id?: string }).id === id) as
    | { kind: string; id: string; result?: unknown; error?: { code: string; message: string } }
    | undefined;

// --- Message handling ---------------------------------------------------------

describe('IframeRpcBridge message handling', () => {
  it('responds with the handler result and posts to target with "*"', async () => {
    const { t, send } = setup({ handlers: { 'a.b': (args) => ({ echo: args[0] }) } });
    send('a.b', [42]);
    await flush();
    expect(t.posted).toEqual([{ message: { kind: 'response', id: 'req-1', result: { echo: 42 } }, origin: '*' }]);
  });

  it('still posts a response (with a result key) when the result is undefined', async () => {
    const { t, send } = setup({ handlers: { noop: () => undefined } });
    send('noop');
    await flush();
    const r = reply(t.messages())!;
    expect(r.kind).toBe('response');
    expect('result' in r).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('ignores a message from an impostor window', async () => {
    const { win, t } = setup({ handlers: { x: vi.fn() } });
    win.dispatch({ data: { kind: 'request', id: 'i', method: 'x', args: [] }, source: {} });
    await flush();
    expect(t.posted).toHaveLength(0);
  });

  it('ignores source null and undefined even when there is no target', async () => {
    const win = new FakeWindow();
    const handler = vi.fn();
    const bridge = new IframeRpcBridge({ context: CTX, handlers: { x: handler }, hostWindow: win, getTarget: () => undefined });
    bridge.attach();
    win.dispatch({ data: { kind: 'request', id: 'i', method: 'x', args: [] }, source: null });
    win.dispatch({ data: { kind: 'request', id: 'i', method: 'x', args: [] }, source: undefined });
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('reads the target lazily (iframe mounting after attach)', async () => {
    const win = new FakeWindow();
    const t = makeTarget();
    let current: typeof t.target | null = null;
    const bridge = new IframeRpcBridge({ context: CTX, handlers: { x: () => 1 }, hostWindow: win, getTarget: () => current });
    bridge.attach();
    current = t.target;
    win.dispatch({ data: { kind: 'request', id: 'r', method: 'x', args: [] }, source: t.target });
    await flush();
    expect(reply(t.messages(), 'r')?.result).toBe(1);
  });

  it('ignores non-request kinds and non-envelopes', async () => {
    const handler = vi.fn();
    const { win, t } = setup({ handlers: { x: handler } });
    for (const data of [
      { kind: 'response', id: 'r', result: 1 },
      { kind: 'event', channel: 'c', payload: 1 },
      { kind: 'heartbeat', ts: 1 },
      { kind: 'nope' },
      'string',
      null,
      42,
    ]) {
      win.dispatch({ data, source: t.target });
    }
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(t.posted).toHaveLength(0);
  });

  it('drops a request whose id is not a string', async () => {
    const handler = vi.fn();
    const { win, t } = setup({ handlers: { x: handler } });
    win.dispatch({ data: { kind: 'request', id: 7, method: 'x', args: [] }, source: t.target });
    win.dispatch({ data: { kind: 'request', method: 'x', args: [] }, source: t.target });
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(t.posted).toHaveLength(0);
  });

  it('replies BridgeError "Malformed request" for bad args or method', async () => {
    const handler = vi.fn();
    const { win, t } = setup({ handlers: { x: handler } });
    win.dispatch({ data: { kind: 'request', id: 'a', method: 'x', args: 'nope' }, source: t.target });
    win.dispatch({ data: { kind: 'request', id: 'b', method: 5, args: [] }, source: t.target });
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(reply(t.messages(), 'a')?.error).toEqual({ code: 'BridgeError', message: 'Malformed request' });
    expect(reply(t.messages(), 'b')?.error).toEqual({ code: 'BridgeError', message: 'Malformed request' });
  });

  it('unknown method keeps the historical message text', async () => {
    const { t, send } = setup();
    send('nope.method');
    await flush();
    expect(reply(t.messages())?.error).toEqual({
      code: 'BridgeError',
      message: 'Unknown iframe bridge method: nope.method',
    });
  });

  it.each(['__proto__', 'toString', 'constructor', 'hasOwnProperty'])('%s is an unknown method', async (m) => {
    const { t, send } = setup({ handlers: { real: () => 1 } });
    send(m);
    await flush();
    expect(reply(t.messages())?.error?.message).toBe(`Unknown iframe bridge method: ${m}`);
  });

  it('turns a synchronous throw and a rejection into error responses', async () => {
    const { t, send } = setup({
      handlers: {
        sync: () => {
          throw new Error('sync boom');
        },
        async: () => Promise.reject(new Error('async boom')),
        str: () => Promise.reject('plain'),
      },
    });
    send('sync', [], 's');
    send('async', [], 'a');
    send('str', [], 'p');
    await flush();
    expect(reply(t.messages(), 's')?.error).toEqual({ code: 'BridgeError', message: 'sync boom' });
    expect(reply(t.messages(), 'a')?.error).toEqual({ code: 'BridgeError', message: 'async boom' });
    expect(reply(t.messages(), 'p')?.error).toEqual({ code: 'BridgeError', message: 'plain' });
    expect(reply(t.messages(), 's')!.error).not.toHaveProperty('data');
  });

  it('keeps the code of an ExtensionApiError', async () => {
    const { t, send } = setup({
      handlers: {
        q: () => {
          throw new ExtensionApiError('QuotaExceededError', 'too much');
        },
      },
    });
    send('q');
    await flush();
    expect(reply(t.messages())?.error).toEqual({ code: 'QuotaExceededError', message: 'too much' });
  });

  it('calls onError for handler failures', async () => {
    const onError = vi.fn();
    const err = new Error('x');
    const { send } = setup({ onError, handlers: { f: () => Promise.reject(err) } });
    send('f');
    await flush();
    expect(onError).toHaveBeenCalledWith(err, 'f');
  });
});

describe('IframeRpcBridge context', () => {
  it('passes host-assembled identity to handlers; the payload cannot override it', async () => {
    const seen: BridgeContext[] = [];
    const { send } = setup({
      handlers: {
        who: (_args, ctx) => {
          seen.push(ctx);
        },
      },
    });
    send('who', [{ extensionId: 'ext.other.victim', panelId: 'evil' }], 'r', {
      extensionId: 'ext.other.victim',
      ctx: { extensionId: 'ext.other.victim' },
    });
    await flush();
    expect(seen[0]?.extensionId).toBe('ext.test.alpha');
    expect(seen[0]?.panelId).toBe('p1');
  });

  it('reads a context getter once per request', async () => {
    let n = 0;
    const seen: string[] = [];
    const { send } = setup({
      context: () => ({ extensionId: `ext.test.n${++n}`, grants: [] }),
      handlers: { who: (_a, ctx) => void seen.push(ctx.extensionId) },
    });
    send('who', [], 'a');
    send('who', [], 'b');
    await flush();
    expect(seen).toEqual(['ext.test.n1', 'ext.test.n2']);
    expect(n).toBe(2);
  });

  it('reports a throwing context getter as an error response', async () => {
    const { t, send } = setup({
      context: () => {
        throw new Error('no ctx');
      },
      handlers: { x: () => 1 },
    });
    send('x');
    await flush();
    expect(reply(t.messages())?.error?.message).toBe('no ctx');
  });
});

describe('IframeRpcBridge lifecycle', () => {
  it('attach twice adds one listener; one response per request', async () => {
    const { win, t, bridge, send } = setup({ handlers: { x: () => 1 } });
    bridge.attach();
    expect(win.listeners.size).toBe(1);
    send('x');
    await flush();
    expect(t.posted).toHaveLength(1);
  });

  it('dispose removes the listener and is idempotent', () => {
    const { win, bridge } = setup();
    expect(bridge.isDisposed).toBe(false);
    bridge.dispose();
    bridge.dispose();
    expect(win.listeners.size).toBe(0);
    expect(bridge.isDisposed).toBe(true);
  });

  it('a handler resolving after dispose posts nothing', async () => {
    let release!: (v: unknown) => void;
    const { t, bridge, send } = setup({ handlers: { slow: () => new Promise((r) => (release = r)) } });
    send('slow');
    bridge.dispose();
    release('late');
    await flush();
    expect(t.posted).toHaveLength(0);
  });

  it('a handler rejecting after dispose posts nothing', async () => {
    let fail!: (e: unknown) => void;
    const { t, bridge, send } = setup({ handlers: { slow: () => new Promise((_r, rej) => (fail = rej)) } });
    send('slow');
    bridge.dispose();
    fail(new Error('late'));
    await flush();
    expect(t.posted).toHaveLength(0);
  });

  it('dispose from inside a handler is safe and drops that reply', async () => {
    let bridgeRef: IframeRpcBridge | undefined;
    const { t, bridge, send } = setup({
      handlers: {
        self: () => {
          bridgeRef?.dispose();
          return 1;
        },
      },
    });
    bridgeRef = bridge;
    send('self');
    await flush();
    expect(bridge.isDisposed).toBe(true);
    expect(t.posted).toHaveLength(0);
  });

  it('attach after dispose does nothing', () => {
    const { win, bridge } = setup();
    bridge.dispose();
    bridge.attach();
    expect(win.listeners.size).toBe(0);
  });

  it('emit posts an RpcEvent to the target; no-op after dispose or without a target', () => {
    const { t, bridge } = setup();
    bridge.emit('theme.changed', { mode: 'dark' });
    expect(t.posted).toEqual([
      { message: { kind: 'event', channel: 'theme.changed', payload: { mode: 'dark' } }, origin: '*' },
    ]);
    bridge.dispose();
    bridge.emit('theme.changed', { mode: 'light' });
    expect(t.posted).toHaveLength(1);

    const win = new FakeWindow();
    const orphan = new IframeRpcBridge({ context: CTX, handlers: {}, hostWindow: win, getTarget: () => null });
    expect(() => orphan.emit('c', 1)).not.toThrow();
  });
});

// --- Authorization --------------------------------------------------------------

describe('uikit.* authorization', () => {
  const specs: Record<string, readonly UiKitComponentSpec[]> = {
    '1': [
      { tag: 'kth-open', hostMethods: ['uikit.open'], requiresPermissions: [] },
      { tag: 'kth-guarded', hostMethods: ['uikit.guarded'], requiresPermissions: ['bible:read'] },
    ],
  };
  const withKit = (uiKit: { version: string; components: string[] }, grants: BridgeContext['grants'] = []): BridgeContext => ({
    extensionId: 'ext.test.alpha',
    manifest: { uiKit },
    grants,
  });

  it('non-uikit methods always pass the built-in check', () => {
    expect(authorizeBridgeMethod('ui.getTheme', { extensionId: 'e', grants: [] })).toEqual({ ok: true });
    expect(authorizeBridgeMethod('uikit', { extensionId: 'e', grants: [] })).toEqual({ ok: true }); // no dot: not the kit
  });

  it('denies: no manifest, no uiKit, unknown version, method not listed, missing permission', () => {
    const decl = { version: '1', components: ['kth-open', 'kth-guarded'] };
    const denied: BridgeContext[] = [
      { extensionId: 'e', grants: ['bible:read'] },
      { extensionId: 'e', manifest: null, grants: ['bible:read'] },
      { extensionId: 'e', manifest: {}, grants: ['bible:read'] },
      withKit({ version: '2', components: ['kth-open'] }),
      withKit({ version: '1', components: ['kth-guarded'] }, ['bible:read']), // uikit.open's component not listed
      withKit(decl, []), // uikit.guarded lacks bible:read
    ];
    expect(authorizeBridgeMethod('uikit.open', denied[0], specs).ok).toBe(false);
    expect(authorizeBridgeMethod('uikit.open', denied[1], specs).ok).toBe(false);
    expect(authorizeBridgeMethod('uikit.open', denied[2], specs).ok).toBe(false);
    expect(authorizeBridgeMethod('uikit.open', denied[3], specs).ok).toBe(false);
    expect(authorizeBridgeMethod('uikit.open', denied[4], specs).ok).toBe(false);
    expect(authorizeBridgeMethod('uikit.guarded', denied[5], specs).ok).toBe(false);
    expect(authorizeBridgeMethod('uikit.unlisted', withKit(decl, ['bible:read']), specs).ok).toBe(false);
  });

  it('allows a listed method with granted permissions', () => {
    const decl = { version: '1', components: ['kth-open', 'kth-guarded'] };
    expect(authorizeBridgeMethod('uikit.open', withKit(decl), specs)).toEqual({ ok: true });
    expect(authorizeBridgeMethod('uikit.guarded', withKit(decl, ['bible:read']), specs)).toEqual({ ok: true });
  });

  it('denial message names the method, not the manifest', () => {
    const r = authorizeBridgeMethod('uikit.open', withKit({ version: '9', components: ['secret-tag'] }), specs);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('uikit.open');
      expect(r.reason).not.toContain('secret-tag');
    }
  });

  it('a registered uikit.* handler is not reachable without the allowlist (handler never runs)', async () => {
    const handler = vi.fn(() => 'secret');
    const { t, send } = setup({ handlers: { 'uikit.anything': handler } });
    send('uikit.anything');
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(reply(t.messages())?.error?.code).toBe('PermissionDeniedError');
  });

  it('the authorize hook can deny; the handler never runs', async () => {
    const handler = vi.fn(() => 1);
    const authorize = vi.fn(() => ({ ok: false as const, reason: 'nope' }));
    const { t, send } = setup({ authorize, handlers: { 'a.b': handler } });
    send('a.b');
    await flush();
    expect(authorize).toHaveBeenCalledWith('a.b', CTX);
    expect(handler).not.toHaveBeenCalled();
    expect(reply(t.messages())?.error).toEqual({ code: 'PermissionDeniedError', message: 'nope' });
  });

  it('the authorize hook is skipped when the built-in check already denied', async () => {
    const authorize = vi.fn(() => ({ ok: true as const }));
    const { send } = setup({ authorize, handlers: { 'uikit.x': () => 1 } });
    send('uikit.x');
    await flush();
    expect(authorize).not.toHaveBeenCalled();
  });

  it('the authorize hook returning ok lets the handler run', async () => {
    const { t, send } = setup({ authorize: () => ({ ok: true }), handlers: { 'a.b': () => 'yes' } });
    send('a.b');
    await flush();
    expect(reply(t.messages())?.result).toBe('yes');
  });
});
