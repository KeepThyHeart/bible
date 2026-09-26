/**
 * A stand-in for the app's renderer, for tests of an extension's PANEL code
 * (the code that runs in the sandboxed iframe and talks to the host through
 * `@bible/extension-ui`).
 *
 * The panel SDK sends RPC requests with `window.parent.postMessage` and
 * receives responses and events as `message` events. This helper replaces
 * `globalThis.parent` with a fake that answers those requests, so a test can
 * run `BibleExtUI.init()`, `getLocale()`, `useHostStyles()` and `loadKit()`
 * with no Electron and no iframe.
 *
 * Run the test in a DOM environment (`// @vitest-environment jsdom`). This
 * package has no DOM type dependency: DOM globals are reached through
 * `globalThis` at call time, and the types below are structural.
 */

import { directionForTag } from '@bible/core';

export type PanelDirection = 'ltr' | 'rtl';

/** A bridge method override: receives the request's `args`, returns (or resolves) the result. */
export type PanelBridgeHandler = (args: unknown[]) => unknown | Promise<unknown>;

export interface MockPanelHostOptions {
  /** BCP 47 tag `ui.getLocale` reports. Default `'en'`. */
  locale?: string;
  /** Default: the locale's own direction. */
  direction?: PanelDirection;
  /** Theme id `ui.getTheme` reports. Default `'light'`. */
  theme?: string;
  /** Override or add bridge methods, keyed by method name (e.g. `'network.fetch'`). */
  handlers?: Record<string, PanelBridgeHandler>;
}

export interface MockPanelHost {
  /** Every request the panel sent, in order. */
  readonly requests: ReadonlyArray<{ method: string; args: unknown[] }>;
  /** Update `ui.getTheme` and emit `theme.changed { mode: id }`. */
  setTheme(id: string): void;
  /** Update `ui.getLocale`. */
  setLocale(locale: string, direction?: PanelDirection): void;
  /** Deliver a host event to the panel (`channel` e.g. `'verse.activeChanged'`). */
  emit(channel: string, payload: unknown): void;
  /** Restore `globalThis.parent`. Call in `afterEach`. */
  dispose(): void;
}

interface RequestEnvelope {
  kind: 'request';
  id: string;
  method: string;
  args: unknown[];
}

interface DomGlobals {
  dispatchEvent(event: unknown): boolean;
  MessageEvent: new (type: string, init: { data: unknown }) => unknown;
}

function domGlobals(): DomGlobals {
  const g = globalThis as unknown as Partial<DomGlobals>;
  if (typeof g.dispatchEvent !== 'function' || typeof g.MessageEvent !== 'function') {
    throw new Error(
      'createMockPanelHost needs a DOM environment: add `// @vitest-environment jsdom` to the top of the test file.',
    );
  }
  return g as DomGlobals;
}

function isRequest(v: unknown): v is RequestEnvelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { kind?: unknown }).kind === 'request' &&
    typeof (v as { id?: unknown }).id === 'string' &&
    typeof (v as { method?: unknown }).method === 'string'
  );
}

/** Install the fake host. Always pair with `dispose()`. */
export function createMockPanelHost(opts: MockPanelHostOptions = {}): MockPanelHost {
  const dom = domGlobals();
  let locale = opts.locale ?? 'en';
  let direction: PanelDirection = opts.direction ?? directionForTag(locale);
  let theme = opts.theme ?? 'light';
  const requests: Array<{ method: string; args: unknown[] }> = [];
  let disposed = false;

  const deliver = (data: unknown): void => {
    dom.dispatchEvent(new dom.MessageEvent('message', { data }));
  };

  const defaults: Record<string, PanelBridgeHandler> = {
    'ui.getLocale': () => ({ locale, direction }),
    'ui.getTheme': () => ({ mode: theme }),
    'ui.showVersePopup': () => undefined,
    'ui.hideVersePopup': () => undefined,
    'bible.navigateToVerse': () => undefined,
  };

  const answer = async (req: RequestEnvelope): Promise<void> => {
    let response: Record<string, unknown>;
    try {
      const handler = opts.handlers?.[req.method] ?? defaults[req.method];
      if (handler) {
        response = { kind: 'response', id: req.id, result: await handler(req.args) };
      } else if (req.method.startsWith('uikit.')) {
        // v1 kit components declare no host methods, so the real bridge denies every uikit.* call.
        response = {
          kind: 'response',
          id: req.id,
          error: { code: 'PermissionDeniedError', message: `Permission denied: ${req.method}` },
        };
      } else {
        response = {
          kind: 'response',
          id: req.id,
          error: { code: 'BridgeError', message: `Unknown iframe bridge method: ${req.method}` },
        };
      }
    } catch (err) {
      const e = err as { name?: string; message?: string };
      response = {
        kind: 'response',
        id: req.id,
        error: { code: e?.name ?? 'BridgeError', message: e?.message ?? String(err) },
      };
    }
    if (!disposed) deliver(response);
  };

  const g = globalThis as unknown as { parent: unknown };
  const original = Object.getOwnPropertyDescriptor(g, 'parent');
  const fakeParent = {
    postMessage(envelope: unknown): void {
      if (!isRequest(envelope)) return;
      requests.push({ method: envelope.method, args: envelope.args });
      // Answer on a microtask, like the async host round trip.
      void Promise.resolve().then(() => answer(envelope));
    },
  };
  Object.defineProperty(g, 'parent', { value: fakeParent, configurable: true, writable: true });

  return {
    requests,
    setTheme(id: string): void {
      theme = id;
      deliver({ kind: 'event', channel: 'theme.changed', payload: { mode: id } });
    },
    setLocale(next: string, dir?: PanelDirection): void {
      locale = next;
      direction = dir ?? directionForTag(next);
    },
    emit(channel: string, payload: unknown): void {
      deliver({ kind: 'event', channel, payload });
    },
    dispose(): void {
      disposed = true;
      if (original) Object.defineProperty(g, 'parent', original);
      else delete (g as { parent?: unknown }).parent;
    },
  };
}
