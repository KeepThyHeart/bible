// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RpcClient } from './RpcClient';

// Mock window.parent.postMessage and window event listener for testing.
// We simulate the "host" side by capturing outgoing messages and sending
// responses back through the message event listener.

let capturedMessages: Array<{ data: unknown; targetOrigin: string }> = [];
let messageHandler: ((event: MessageEvent) => void) | undefined;

beforeEach(() => {
  capturedMessages = [];

  // Mock window.parent.postMessage
  (globalThis as unknown as { parent: { postMessage: (data: unknown, origin: string) => void } }).parent = {
    postMessage: (data: unknown, origin: string) => {
      capturedMessages.push({ data, targetOrigin: origin });
    },
  };

  // Intercept addEventListener to capture the handler
  const originalAdd = window.addEventListener;
  vi.spyOn(window, 'addEventListener').mockImplementation(
    (type: string, handler: EventListenerOrEventListenerObject) => {
      if (type === 'message' && typeof handler === 'function') {
        messageHandler = handler as (event: MessageEvent) => void;
      }
      originalAdd.call(window, type, handler);
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  messageHandler = undefined;
});

function simulateResponse(id: string, result?: unknown, error?: { code: string; message: string }) {
  const event = new MessageEvent('message', {
    data: error
      ? { kind: 'response', id, error }
      : { kind: 'response', id, result },
  });
  messageHandler?.(event);
}

function simulateEvent(channel: string, payload: unknown) {
  const event = new MessageEvent('message', {
    data: { kind: 'event', channel, payload },
  });
  messageHandler?.(event);
}

describe('RpcClient', () => {
  it('sends an RpcRequest envelope via postMessage', () => {
    const client = new RpcClient({ timeoutMs: 5000 });
    const promise = client.request('test.method', [1, 'two']);

    expect(capturedMessages).toHaveLength(1);
    const sent = capturedMessages[0].data as { kind: string; method: string; args: unknown[] };
    expect(sent.kind).toBe('request');
    expect(sent.method).toBe('test.method');
    expect(sent.args).toEqual([1, 'two']);

    // Resolve to prevent timeout
    simulateResponse(sent.id as string, 'ok');
    return promise;
  });

  it('resolves with the result from host', async () => {
    const client = new RpcClient({ timeoutMs: 5000 });
    const promise = client.request<string>('test.echo', ['hello']);

    const sent = capturedMessages[0].data as { id: string };
    simulateResponse(sent.id, 'world');

    await expect(promise).resolves.toBe('world');
    client.dispose();
  });

  it('rejects with error from host', async () => {
    const client = new RpcClient({ timeoutMs: 5000 });
    const promise = client.request('test.fail', []);

    const sent = capturedMessages[0].data as { id: string };
    simulateResponse(sent.id, undefined, { code: 'TestError', message: 'boom' });

    await expect(promise).rejects.toThrow('boom');
    client.dispose();
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    const client = new RpcClient({ timeoutMs: 100 });
    const promise = client.request('test.slow', []);

    vi.advanceTimersByTime(150);

    await expect(promise).rejects.toThrow(/timeout/i);
    client.dispose();
    vi.useRealTimers();
  });

  it('dispatches events to subscribers', () => {
    const client = new RpcClient();
    const cb = vi.fn();
    client.on('verse.activeChanged', cb);

    simulateEvent('verse.activeChanged', 43003016);

    expect(cb).toHaveBeenCalledWith(43003016);
    client.dispose();
  });

  it('unsubscribes via dispose handle', () => {
    const client = new RpcClient();
    const cb = vi.fn();
    const sub = client.on('verse.activeChanged', cb);

    sub.dispose();
    simulateEvent('verse.activeChanged', 1001001);

    expect(cb).not.toHaveBeenCalled();
    client.dispose();
  });

  it('rejects all pending requests on dispose', async () => {
    const client = new RpcClient({ timeoutMs: 60000 });
    const p1 = client.request('test.a', []);
    const p2 = client.request('test.b', []);

    client.dispose();

    await expect(p1).rejects.toThrow(/disposed/i);
    await expect(p2).rejects.toThrow(/disposed/i);
  });

  it('ignores unknown response IDs', () => {
    const client = new RpcClient();
    // Should not throw
    simulateResponse('nonexistent-id-123', 'stale');
    client.dispose();
  });
});
