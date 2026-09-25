/**
 * `verseHoverPopupStore`'s dwell/spinner/timeout/grace state machine (task
 * 0036, P0.1c; design doc §11.3, §16's component-test plan: "no query
 * before 250ms; a sweep across five words fires zero [or, here, at most
 * one] queries; spinner not shown for a 20ms provider, shown for a 500ms
 * one; close grace cancelled by entering the popup; empty result opens
 * nothing").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Extensions } from '@bible/core';

vi.mock('./extensionRendererBridge', () => ({
  invokeUiBridge: vi.fn(),
}));

import { invokeUiBridge } from './extensionRendererBridge';
import { useExtensionUiStore } from './extensionUiStore';
import { useAmbientPopupStore } from '../stores/useAmbientPopupStore';
import {
  useVerseHoverPopupStore,
  __resetVerseHoverPopupStore,
  EXTENSION_HOVER_POPUP_OWNER_ID,
  type HoverTarget,
} from './verseHoverPopupStore';

const mockInvoke = vi.mocked(invokeUiBridge);

function target(overrides: Partial<HoverTarget> = {}): HoverTarget {
  return {
    verseId: 1001001,
    moduleId: 1,
    moduleAbbrev: 'kjv',
    surface: 'standard',
    modifiers: [],
    position: { x: 10, y: 20 },
    staticHovers: [],
    ...overrides,
  };
}

/** Never-resolving promise, for exercising the spinner/pending states. */
function pending<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function seedOneHoverProvider(): void {
  useExtensionUiStore.setState({
    verseHoverProviders: [
      {
        key: 'ext.acme::hover1',
        extensionId: 'ext.acme',
        descriptor: { id: 'hover1', hoverEndpoint: 'ext.acme.hover' } as Extensions.VerseHoverProviderDescriptor,
      },
    ],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetVerseHoverPopupStore();
  useExtensionUiStore.setState({ verseHoverProviders: [] });
  useAmbientPopupStore.setState({ owner: null });
  mockInvoke.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('dwell (250ms)', () => {
  it('no popup and no fetch before the dwell elapses', async () => {
    seedOneHoverProvider();
    mockInvoke.mockResolvedValue({ results: [] });
    useVerseHoverPopupStore.getState().hover(target());

    await vi.advanceTimersByTimeAsync(249);
    expect(useVerseHoverPopupStore.getState().popup).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('a sweep across several targets before any dwell completes fires at most one fetch - for the last target only', async () => {
    seedOneHoverProvider();
    mockInvoke.mockResolvedValue({ results: [] });
    const store = useVerseHoverPopupStore.getState();

    for (let i = 0; i < 5; i++) {
      store.hover(target({ verseId: 1001001 + i }));
      await vi.advanceTimersByTimeAsync(50); // well under the 250ms dwell
    }
    await vi.advanceTimersByTimeAsync(250);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('fetchVerseHover', [expect.objectContaining({ verseId: 1001005 })]);
  });

  it('static content renders immediately at the dwell, with no loading state', async () => {
    // No hover providers registered - pure static-content path, no fetch at all.
    useVerseHoverPopupStore.getState().hover(
      target({ staticHovers: [{ layerKey: 'ext.a::dec', extensionId: 'ext.a', content: { kind: 'text', text: 'static!' }, order: 0 }] }),
    );
    await vi.advanceTimersByTimeAsync(250);

    const popup = useVerseHoverPopupStore.getState().popup;
    expect(popup?.sections).toEqual([
      { key: 'static:ext.a::dec:0', extensionId: 'ext.a', content: { kind: 'text', text: 'static!' } },
    ]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('spinner (150ms after the dwell fires)', () => {
  it('is NOT shown for a fast provider (resolves before 150ms)', async () => {
    seedOneHoverProvider();
    mockInvoke.mockResolvedValue({
      results: [{ extensionId: 'ext.acme', providerId: 'hover1', status: 'ok', content: [{ kind: 'text', text: 'fast' }] }],
    });
    useVerseHoverPopupStore.getState().hover(target());

    await vi.advanceTimersByTimeAsync(250 + 20); // dwell + a fast resolve
    const popup = useVerseHoverPopupStore.getState().popup;
    expect(popup?.sections.some((s) => s.content === 'loading')).toBe(false);
    expect(popup?.sections[0].content).toEqual({ kind: 'text', text: 'fast' });
  });

  it('IS shown after 150ms for a slow provider, before content arrives', async () => {
    seedOneHoverProvider();
    const { promise } = pending<unknown>();
    mockInvoke.mockReturnValue(promise);
    useVerseHoverPopupStore.getState().hover(target());

    await vi.advanceTimersByTimeAsync(250 + 149);
    expect(useVerseHoverPopupStore.getState().popup).toBeNull(); // not yet

    await vi.advanceTimersByTimeAsync(2); // crosses the 150ms spinner threshold
    const popup = useVerseHoverPopupStore.getState().popup;
    expect(popup?.sections.some((s) => s.content === 'loading')).toBe(true);
  });
});

describe('close grace (120ms)', () => {
  it('stays open through the grace period and closes after it', async () => {
    useVerseHoverPopupStore.getState().hover(
      target({ staticHovers: [{ layerKey: 'ext.a::dec', extensionId: 'ext.a', content: { kind: 'text', text: 'x' }, order: 0 }] }),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(useVerseHoverPopupStore.getState().popup).not.toBeNull();

    useVerseHoverPopupStore.getState().scheduleClose();
    await vi.advanceTimersByTimeAsync(119);
    expect(useVerseHoverPopupStore.getState().popup).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2);
    expect(useVerseHoverPopupStore.getState().popup).toBeNull();
  });

  it('cancelClose (entering the popup) cancels a pending close', async () => {
    useVerseHoverPopupStore.getState().hover(
      target({ staticHovers: [{ layerKey: 'ext.a::dec', extensionId: 'ext.a', content: { kind: 'text', text: 'x' }, order: 0 }] }),
    );
    await vi.advanceTimersByTimeAsync(250);

    useVerseHoverPopupStore.getState().scheduleClose();
    await vi.advanceTimersByTimeAsync(60);
    useVerseHoverPopupStore.getState().cancelClose();
    await vi.advanceTimersByTimeAsync(1000);

    expect(useVerseHoverPopupStore.getState().popup).not.toBeNull();
  });

  it('scheduleClose before the dwell ever completes just cancels the pending show, nothing to close', async () => {
    useVerseHoverPopupStore.getState().hover(target());
    await vi.advanceTimersByTimeAsync(100);
    useVerseHoverPopupStore.getState().scheduleClose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(useVerseHoverPopupStore.getState().popup).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('empty results and failures - close silently, no error UI (design doc §11.4)', () => {
  it('a provider returning [] with no static content opens nothing', async () => {
    seedOneHoverProvider();
    mockInvoke.mockResolvedValue({
      results: [{ extensionId: 'ext.acme', providerId: 'hover1', status: 'ok', content: [] }],
    });
    useVerseHoverPopupStore.getState().hover(target());
    await vi.advanceTimersByTimeAsync(500);
    expect(useVerseHoverPopupStore.getState().popup).toBeNull();
  });

  it('a timeout/error status is simply omitted - if nothing else exists, nothing opens', async () => {
    seedOneHoverProvider();
    mockInvoke.mockResolvedValue({
      results: [{ extensionId: 'ext.acme', providerId: 'hover1', status: 'timeout', content: [] }],
    });
    useVerseHoverPopupStore.getState().hover(target());
    await vi.advanceTimersByTimeAsync(500);
    expect(useVerseHoverPopupStore.getState().popup).toBeNull();
  });

  it('a failed callback fetch falls back to static content when there is some', async () => {
    seedOneHoverProvider();
    mockInvoke.mockRejectedValue(new Error('bridge not attached'));
    useVerseHoverPopupStore.getState().hover(
      target({ staticHovers: [{ layerKey: 'ext.a::dec', extensionId: 'ext.a', content: { kind: 'text', text: 'still here' }, order: 0 }] }),
    );
    await vi.advanceTimersByTimeAsync(500);
    const popup = useVerseHoverPopupStore.getState().popup;
    expect(popup?.sections).toEqual([{ key: 'static:ext.a::dec:0', extensionId: 'ext.a', content: { kind: 'text', text: 'still here' } }]);
  });

  it('when nothing at all is registered, no fetch is even attempted', async () => {
    // No seedOneHoverProvider() - verseHoverProviders is empty.
    useVerseHoverPopupStore.getState().hover(target());
    await vi.advanceTimersByTimeAsync(500);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useVerseHoverPopupStore.getState().popup).toBeNull();
  });
});

describe('request supersession', () => {
  it('a stale response from a superseded hover never lands', async () => {
    seedOneHoverProvider();
    const first = pending<unknown>();
    const second = pending<unknown>();
    mockInvoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    useVerseHoverPopupStore.getState().hover(target({ verseId: 1 }));
    await vi.advanceTimersByTimeAsync(250);

    useVerseHoverPopupStore.getState().hover(target({ verseId: 2 }));
    await vi.advanceTimersByTimeAsync(250);

    // The FIRST request resolves late, after the second has already fired.
    first.resolve({ results: [{ extensionId: 'ext.acme', providerId: 'hover1', status: 'ok', content: [{ kind: 'text', text: 'STALE' }] }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(useVerseHoverPopupStore.getState().popup?.sections.some((s) => s.content && s.content !== 'loading' && (s.content as { text?: string }).text === 'STALE')).toBe(false);

    second.resolve({ results: [{ extensionId: 'ext.acme', providerId: 'hover1', status: 'ok', content: [{ kind: 'text', text: 'current' }] }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(useVerseHoverPopupStore.getState().popup?.sections[0].content).toEqual({ kind: 'text', text: 'current' });
  });
});

describe('ambient popup coordination (amendment A6)', () => {
  it('claims the ambient popup slot when it opens, releases it when it closes', async () => {
    useVerseHoverPopupStore.getState().hover(
      target({ staticHovers: [{ layerKey: 'ext.a::dec', extensionId: 'ext.a', content: { kind: 'text', text: 'x' }, order: 0 }] }),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(useAmbientPopupStore.getState().owner).toBe(EXTENSION_HOVER_POPUP_OWNER_ID);

    useVerseHoverPopupStore.getState().closeNow();
    expect(useAmbientPopupStore.getState().owner).toBeNull();
  });

  it('closes itself when another ambient popup claims the slot', async () => {
    useVerseHoverPopupStore.getState().hover(
      target({ staticHovers: [{ layerKey: 'ext.a::dec', extensionId: 'ext.a', content: { kind: 'text', text: 'x' }, order: 0 }] }),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(useVerseHoverPopupStore.getState().popup).not.toBeNull();

    useAmbientPopupStore.getState().claim('someone-else');
    expect(useVerseHoverPopupStore.getState().popup).toBeNull();
  });
});
