/**
 * The renderer half of the panel-to-worker channel (`PlatformPlan.md` P0).
 *
 * `panelsApiImpl` guards the main-process side; this file guards the side an
 * untrusted iframe actually talks to. The property under test is the one the
 * whole design rests on:
 *
 *   **Every identifier reaches the host from the closure that mounted the
 *   iframe. The iframe supplies only the message.**
 *
 * `network.fetch` has always worked this way, and for the same reason: a panel
 * that could name an extension could spend another extension's grants. When
 * the channel was added it became a second place that rule has to hold, so it
 * is asserted here rather than assumed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { useIframeBridge } from './useIframeBridge';
import { deliverPanelMessage } from '../../extensions/extensionUiStore';

const panelInvoke = vi.fn().mockResolvedValue({ ok: true });

/**
 * Mount the bridge against a stub iframe.
 *
 * `contentWindow` is faked because the bridge identifies its iframe by object
 * identity of `event.source` - that identity check is what stops another
 * frame on the page from impersonating the panel, so the test has to honour
 * it rather than work around it.
 */
function mountBridge(opts: { panelId?: string; panelTypeId?: string }) {
  const posted: unknown[] = [];
  const contentWindow = {
    postMessage: (envelope: unknown) => {
      posted.push(envelope);
    },
  } as unknown as Window;
  const iframeRef = {
    current: { contentWindow } as unknown as HTMLIFrameElement,
  } as React.RefObject<HTMLIFrameElement | null>;

  const Harness: React.FC = () => {
    useIframeBridge({ extensionId: 'ext.test.alpha', iframeRef, ...opts });
    return null;
  };
  const utils = render(<Harness />);

  /** Post a request at the host as the iframe would. */
  const send = (method: string, args: unknown[], id = 'req-1') => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { kind: 'request', id, method, args },
        source: contentWindow,
      }),
    );
  };

  /** Post as some *other* frame - must be ignored outright. */
  const sendFromImpostor = (method: string, args: unknown[], id = 'req-x') => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { kind: 'request', id, method, args },
        source: {} as Window,
      }),
    );
  };

  return { ...utils, posted, send, sendFromImpostor };
}

/** Let the bridge's promise chain settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

// The shared test setup defines `window.electron` as writable-but-not-
// configurable, so this saves and restores the value rather than deleting the
// property - `delete` throws on it.
let savedElectron: unknown;

beforeEach(() => {
  vi.clearAllMocks();
  const w = window as unknown as { electron?: unknown };
  savedElectron = w.electron;
  w.electron = { extensions: { panelInvoke } };
});

afterEach(() => {
  (window as unknown as { electron?: unknown }).electron = savedElectron;
});

describe('panel.invoke', () => {
  it('forwards the message with host-supplied identity', async () => {
    const { send } = mountBridge({ panelId: 'panel-7', panelTypeId: 'main' });

    send('panel.invoke', [{ type: 'getRange' }]);
    await flush();

    expect(panelInvoke).toHaveBeenCalledWith(
      'ext.test.alpha',
      'panel-7',
      'main',
      { type: 'getRange' },
    );
  });

  it('ignores anything in the payload that looks like an identity', async () => {
    const { send } = mountBridge({ panelId: 'panel-7', panelTypeId: 'main' });

    // A hostile panel naming another extension. Only `args[0]` crosses, and it
    // crosses as the opaque message - the three identifiers are positional and
    // come from the closure.
    send('panel.invoke', [
      { extensionId: 'ext.other.victim', panelId: 'not-mine', payload: 1 },
    ]);
    await flush();

    const [extensionId, panelId, panelTypeId] = panelInvoke.mock.calls[0]!;
    expect(extensionId).toBe('ext.test.alpha');
    expect(panelId).toBe('panel-7');
    expect(panelTypeId).toBe('main');
  });

  it('refuses when the panel was mounted without an identity', async () => {
    // A bridge mounted for navigation and theme only has no panel identity, so
    // there is no honest value to send. Refusing beats guessing one.
    const { send, posted } = mountBridge({});

    send('panel.invoke', [{ type: 'load' }]);
    await flush();

    expect(panelInvoke).not.toHaveBeenCalled();
    const reply = posted.find(
      (p) => (p as { id?: string }).id === 'req-1',
    ) as { error?: { message: string } };
    expect(reply?.error?.message).toMatch(/without an identity/);
  });

  it('ignores a message from a window that is not this panel’s iframe', async () => {
    const { sendFromImpostor } = mountBridge({ panelId: 'p', panelTypeId: 't' });

    sendFromImpostor('panel.invoke', [{ type: 'load' }]);
    await flush();

    expect(panelInvoke).not.toHaveBeenCalled();
  });

  it('returns the worker’s reply to the iframe', async () => {
    const { send, posted } = mountBridge({ panelId: 'p', panelTypeId: 't' });

    send('panel.invoke', [{ type: 'load' }]);
    await flush();

    const reply = posted.find((p) => (p as { id?: string }).id === 'req-1');
    expect(reply).toMatchObject({ kind: 'response', id: 'req-1', result: { ok: true } });
  });

  it('reports a rejecting worker as an error response, not a hang', async () => {
    panelInvoke.mockRejectedValueOnce(new Error('handler exploded'));
    const { send, posted } = mountBridge({ panelId: 'p', panelTypeId: 't' });

    send('panel.invoke', [{}]);
    await flush();

    const reply = posted.find((p) => (p as { id?: string }).id === 'req-1') as {
      error?: { message: string };
    };
    expect(reply?.error?.message).toMatch(/handler exploded/);
  });
});

describe('worker -> panel push', () => {
  it('delivers a message addressed to this extension', async () => {
    const { posted } = mountBridge({ panelId: 'panel-7', panelTypeId: 'main' });

    deliverPanelMessage({ extensionId: 'ext.test.alpha', message: { tick: 1 } });
    await flush();

    expect(posted).toContainEqual({
      kind: 'event',
      channel: 'panel.message',
      payload: { tick: 1 },
    });
  });

  it('does not deliver another extension’s message', async () => {
    const { posted } = mountBridge({ panelId: 'panel-7', panelTypeId: 'main' });

    deliverPanelMessage({ extensionId: 'ext.other', message: { tick: 1 } });
    await flush();

    expect(posted).toHaveLength(0);
  });

  it('honours a message addressed to one specific panel', async () => {
    const { posted } = mountBridge({ panelId: 'panel-7', panelTypeId: 'main' });

    deliverPanelMessage({
      extensionId: 'ext.test.alpha',
      panelId: 'panel-9',
      message: { tick: 1 },
    });
    await flush();

    expect(posted).toHaveLength(0);
  });

  it('stops delivering once the panel host unmounts', async () => {
    const { posted, unmount } = mountBridge({ panelId: 'panel-7', panelTypeId: 'main' });
    unmount();

    deliverPanelMessage({ extensionId: 'ext.test.alpha', message: { tick: 1 } });
    await flush();

    expect(posted).toHaveLength(0);
  });
});
