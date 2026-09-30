/**
 * `ExtensionPointWiring.ts` unit tests.
 *
 * Task 0024 round 3 (P0.3) moved every bridge-sourced forward event (active
 * verse, word selection, notes/highlights change, locale change, panel
 * open/close/focus) out of its per-worker api-impl and into this one
 * host-level module, which subscribes to each bridge once and fans a change
 * out to every active, permitted worker via `dispatchExtensionPoint`. These
 * tests replace the per-api-impl "emits onDid* only when subscribed"
 * assertions that used to live in `ApiImpls.test.ts`, `Iteration.test.ts`
 * and `NotesHighlightsBookmarks.test.ts`.
 *
 * A fake `ExtensionHostContext` is built from real `ExtensionRpcRouter`s
 * (over in-memory paired transports, the same pattern `ApiImpls.test.ts`
 * uses) and the real `InMemoryXxxBridge` fakes from `../api-impl`, cast to
 * `ExtensionHostContext` - only the fields `wireExtensionPoints` /
 * `installReplayHooks` / `dispatchExtensionPoint` actually touch are
 * populated.
 */

import { describe, it, expect } from 'vitest';
import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import {
  InMemoryBibleBridge,
  InMemoryHighlightsBridge,
  InMemoryL10nBridge,
  InMemoryNotesBridge,
  InMemoryWorkspaceBridge,
} from '../api-impl';
import type { ExtensionHostContext } from '../ExtensionHostTypes';
import { wireExtensionPoints, installReplayHooks, dispatchExtensionPoint } from '../ExtensionPointWiring';

type RpcEvent = Extensions.RpcEvent;
type ExtensionPermission = Extensions.ExtensionPermission;

function pairedTransports(): {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
} {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostSent: unknown[] = [];
  const hostSide: IRpcTransport = {
    send(env) {
      hostSent.push(env);
      workerHandler?.(env);
    },
    onMessage(h) {
      hostHandler = h;
    },
    close() {
      hostHandler = null;
    },
  };
  const workerSide: IRpcTransport = {
    send(env) {
      hostHandler?.(env);
    },
    onMessage(h) {
      workerHandler = h;
    },
    close() {
      workerHandler = null;
    },
  };
  return { hostSide, workerSide, hostSent };
}

function isEventOn(env: unknown, channel: string): boolean {
  return (
    typeof env === 'object' &&
    env !== null &&
    (env as RpcEvent).kind === 'event' &&
    (env as RpcEvent).channel === channel
  );
}

interface FakeWorker {
  extensionId: string;
  router: ExtensionRpcRouter;
  hostSent: unknown[];
  workerSide: IRpcTransport;
  grantedPermissions: ExtensionPermission[];
}

/** Build one active worker: a real router over an in-memory transport pair. */
function makeWorker(extensionId: string, grantedPermissions: ExtensionPermission[] = []): FakeWorker {
  const { hostSide, workerSide, hostSent } = pairedTransports();
  const router = new ExtensionRpcRouter(hostSide);
  return { extensionId, router, hostSent, workerSide, grantedPermissions };
}

function subscribe(worker: FakeWorker, channel: string, order?: number): void {
  worker.workerSide.send({
    kind: 'subscribe',
    id: `sub-${channel}`,
    channel,
    ...(order !== undefined ? { order } : {}),
  });
}

interface FakeCtxOpts {
  bibleBridge?: InMemoryBibleBridge;
  notesBridge?: InMemoryNotesBridge;
  highlightsBridge?: InMemoryHighlightsBridge;
  l10nBridge?: InMemoryL10nBridge;
  workspaceBridge?: InMemoryWorkspaceBridge;
  workers?: FakeWorker[];
}

function makeCtx(opts: FakeCtxOpts): ExtensionHostContext {
  const activeWorkers = new Map(
    (opts.workers ?? []).map((w) => [w.extensionId, { router: w.router } as never]),
  );
  const grants = new Map((opts.workers ?? []).map((w) => [w.extensionId, w.grantedPermissions]));
  return {
    activeWorkers,
    registry: {
      getEntry: (id: string) => ({ grantedPermissions: grants.get(id) ?? [] }),
    },
    bibleBridge: opts.bibleBridge,
    notesBridge: opts.notesBridge,
    highlightsBridge: opts.highlightsBridge,
    l10nBridge: opts.l10nBridge,
    workspaceBridge: opts.workspaceBridge,
  } as unknown as ExtensionHostContext;
}

describe('wireExtensionPoints', () => {
  it('dispatches verse.activeChanged and verse.wordSelected only to subscribed workers', () => {
    const bibleBridge = new InMemoryBibleBridge();
    const w1 = makeWorker('ext.test.one');
    const w2 = makeWorker('ext.test.two');
    const ctx = makeCtx({ bibleBridge, workers: [w1, w2] });
    wireExtensionPoints(ctx);

    subscribe(w1, 'verse.activeChanged');
    bibleBridge.fireActiveVerse({ verseId: 43003016, module: 'kjv' });

    expect(w1.hostSent.filter((e) => isEventOn(e, 'verse.activeChanged'))).toHaveLength(1);
    expect(w2.hostSent.filter((e) => isEventOn(e, 'verse.activeChanged'))).toHaveLength(0);

    subscribe(w2, 'verse.wordSelected');
    bibleBridge.fireWordSelection({
      verseId: 43003016,
      range: { verseId: 43003016, startOffset: 0, endOffset: 3 },
      word: 'God',
    });
    expect(w2.hostSent.filter((e) => isEventOn(e, 'verse.wordSelected'))).toHaveLength(1);
    expect(w1.hostSent.filter((e) => isEventOn(e, 'verse.wordSelected'))).toHaveLength(0);
  });

  it('dispatches notes.changed only to a worker granted notes:read', () => {
    const notesBridge = new InMemoryNotesBridge();
    const granted = makeWorker('ext.test.granted', ['notes:read']);
    const ungranted = makeWorker('ext.test.ungranted', []);
    const ctx = makeCtx({ notesBridge, workers: [granted, ungranted] });
    wireExtensionPoints(ctx);

    subscribe(granted, 'notes.changed');
    subscribe(ungranted, 'notes.changed');
    notesBridge.create({ content: 'hello' });

    expect(granted.hostSent.filter((e) => isEventOn(e, 'notes.changed'))).toHaveLength(1);
    expect(ungranted.hostSent.filter((e) => isEventOn(e, 'notes.changed'))).toHaveLength(0);
  });

  it('dispatches highlights.afterChange only to a worker granted highlights:read', () => {
    const highlightsBridge = new InMemoryHighlightsBridge();
    const granted = makeWorker('ext.test.granted', ['highlights:read']);
    const ctx = makeCtx({ highlightsBridge, workers: [granted] });
    wireExtensionPoints(ctx);

    subscribe(granted, 'highlights.afterChange');
    highlightsBridge.create({ range: { verseId: 43003016 }, styleId: 'yellow' });

    const events = granted.hostSent.filter((e) => isEventOn(e, 'highlights.afterChange'));
    expect(events).toHaveLength(1);
    expect((events[0] as RpcEvent).payload).toEqual({ verseId: 43003016 });
  });

  it('wraps the bridge locale string as { locale } for locale.changed', () => {
    const l10nBridge = new InMemoryL10nBridge();
    const w = makeWorker('ext.test.l10n');
    const ctx = makeCtx({ l10nBridge, workers: [w] });
    wireExtensionPoints(ctx);

    subscribe(w, 'locale.changed');
    l10nBridge.setLocale('es');

    const events = w.hostSent.filter((e) => isEventOn(e, 'locale.changed'));
    expect(events).toHaveLength(1);
    expect((events[0] as RpcEvent).payload).toEqual({ locale: 'es' });
  });

  it('dispatches panel.opened, panel.closed and panel.focused from one workspace bridge', () => {
    const workspaceBridge = new InMemoryWorkspaceBridge();
    const w = makeWorker('ext.test.workspace');
    const ctx = makeCtx({ workspaceBridge, workers: [w] });
    wireExtensionPoints(ctx);

    subscribe(w, 'panel.opened');
    subscribe(w, 'panel.closed');
    subscribe(w, 'panel.focused');

    const panelId = workspaceBridge.openPanel('bible');
    expect(w.hostSent.filter((e) => isEventOn(e, 'panel.opened'))).toHaveLength(1);
    expect(w.hostSent.filter((e) => isEventOn(e, 'panel.focused'))).toHaveLength(1);

    workspaceBridge.closePanel(panelId);
    expect(w.hostSent.filter((e) => isEventOn(e, 'panel.closed'))).toHaveLength(1);
  });

  it('is a no-op for a bridge that was never supplied', () => {
    const ctx = makeCtx({});
    // Must not throw when no bridges are wired at all (matches production
    // today: notesBridge/highlightsBridge are not passed by main.ts).
    expect(() => wireExtensionPoints(ctx)).not.toThrow();
  });
});

describe('installReplayHooks', () => {
  it('replays the current active verse to a subscriber, and does not replay null', () => {
    const bibleBridge = new InMemoryBibleBridge();
    (bibleBridge as unknown as { getActiveVerse: () => { verseId: number; module: string } | null }).getActiveVerse =
      () => ({ verseId: 43003016, module: 'kjv' });
    const w = makeWorker('ext.test.replay');
    const ctx = makeCtx({ bibleBridge, workers: [w] });
    installReplayHooks(ctx, w.router);

    subscribe(w, 'verse.activeChanged');
    const events = w.hostSent.filter((e) => isEventOn(e, 'verse.activeChanged'));
    expect(events).toHaveLength(1);
    expect((events[0] as RpcEvent).payload).toEqual({ verseId: 43003016, module: 'kjv' });
  });

  it('does not replay when there is no current active verse', () => {
    const bibleBridge = new InMemoryBibleBridge();
    const w = makeWorker('ext.test.no-replay');
    const ctx = makeCtx({ bibleBridge, workers: [w] });
    installReplayHooks(ctx, w.router);

    subscribe(w, 'verse.activeChanged');
    expect(w.hostSent.filter((e) => isEventOn(e, 'verse.activeChanged'))).toHaveLength(0);
  });
});

describe('dispatchExtensionPoint zero-subscriber defaults', () => {
  it('returns undefined for an event channel with no subscribers', async () => {
    const ctx = makeCtx({});
    const result = await dispatchExtensionPoint(ctx, 'highlights.afterChange', { verseId: 1 });
    expect(result).toBeUndefined();
  });

  it("returns 'continue' for a cancelable filter channel with no subscribers", async () => {
    const ctx = makeCtx({});
    const result = await dispatchExtensionPoint(ctx, 'notes.beforeDelete', { noteId: 1 });
    expect(result).toBe('continue');
  });

  it('returns [] for a provider channel with no subscribers', async () => {
    const ctx = makeCtx({});
    const result = await dispatchExtensionPoint(ctx, 'crossReferences.requested', { verseId: 1 });
    expect(result).toEqual([]);
  });
});
