/**
 * Unit tests for `VerseDecorationService` (task 0036).
 *
 * `registerDecorator`/`registerHoverProvider` take the fetch closure
 * directly, so these tests construct fake closures inline rather than a fake
 * `ExtensionRpcRouter` - no RPC/worker layer is exercised here at all, only
 * the service's own fan-out, filtering, backoff and validation logic.
 *
 * P0.1a shipped with no direct test file for this class (its registration
 * surface is covered indirectly through `UiTier2.test.ts`'s worker-call
 * round trips). This file adds direct coverage, focused on P0.1c's new
 * `fetchHover` - the design doc's own test plan (§16) asks for exactly this:
 * "the reverse-RPC call shape... parallel fan-out... backoff".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Extensions } from '@bible/core';
import { VerseDecorationService, type VerseDecorationNotifier } from './VerseDecorationService';

type VerseHoverProviderDescriptor = Extensions.VerseHoverProviderDescriptor;
type VerseDecoratorDescriptor = Extensions.VerseDecoratorDescriptor;

function fakeNotifier(): VerseDecorationNotifier & { calls: { op: string; args: unknown[] }[] } {
  const calls: { op: string; args: unknown[] }[] = [];
  return {
    calls,
    notify(op, args) {
      calls.push({ op, args });
    },
  };
}

function hoverDescriptor(overrides: Partial<VerseHoverProviderDescriptor> = {}): VerseHoverProviderDescriptor {
  return { id: 'hover1', hoverEndpoint: 'ext.acme.hover', ...overrides };
}

function decoratorDescriptor(overrides: Partial<VerseDecoratorDescriptor> = {}): VerseDecoratorDescriptor {
  return { id: 'dec1', decorateEndpoint: 'ext.acme.decorate', ...overrides };
}

const BASE_HOVER_REQ = {
  verseId: 1001001,
  moduleId: 1,
  moduleAbbrev: 'kjv',
  surface: 'standard' as const,
  modifiers: [] as Extensions.VerseHoverFetchRequest['modifiers'],
};

describe('VerseDecorationService.fetchHover', () => {
  it('calls a matching provider once with a VerseHoverRequestDto (no surface field)', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const fetch = vi.fn().mockResolvedValue([{ kind: 'text', text: 'hi' }]);
    svc.registerHoverProvider('ext.acme', hoverDescriptor(), fetch);

    const res = await svc.fetchHover(BASE_HOVER_REQ);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith({
      verseId: BASE_HOVER_REQ.verseId,
      moduleId: BASE_HOVER_REQ.moduleId,
      moduleAbbrev: BASE_HOVER_REQ.moduleAbbrev,
      modifiers: [],
    });
    expect(res.results).toEqual([
      { extensionId: 'ext.acme', providerId: 'hover1', status: 'ok', content: [{ kind: 'text', text: 'hi' }] },
    ]);
  });

  it('scope "verse" (default) does not fire when the request is word-scoped', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const fetch = vi.fn().mockResolvedValue([]);
    svc.registerHoverProvider('ext.acme', hoverDescriptor(), fetch);

    await svc.fetchHover({ ...BASE_HOVER_REQ, word: { renderedIndex: 0, text: 'God' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('scope "word" does not fire for a verse-scoped (no word) request', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const fetch = vi.fn().mockResolvedValue([]);
    svc.registerHoverProvider('ext.acme', hoverDescriptor({ scope: 'word' }), fetch);

    await svc.fetchHover(BASE_HOVER_REQ);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('scope "both" fires either way', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const fetch = vi.fn().mockResolvedValue([]);
    svc.registerHoverProvider('ext.acme', hoverDescriptor({ scope: 'both' }), fetch);

    await svc.fetchHover(BASE_HOVER_REQ);
    await svc.fetchHover({ ...BASE_HOVER_REQ, word: { renderedIndex: 0, text: 'God' } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('filters by surfaces - default surfaces exclude reading mode', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const fetch = vi.fn().mockResolvedValue([]);
    svc.registerHoverProvider('ext.acme', hoverDescriptor(), fetch); // default surfaces: standard, study

    await svc.fetchHover({ ...BASE_HOVER_REQ, surface: 'reading' });
    expect(fetch).not.toHaveBeenCalled();

    await svc.fetchHover({ ...BASE_HOVER_REQ, surface: 'standard' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('an explicit reading opt-in fires there too', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const fetch = vi.fn().mockResolvedValue([]);
    svc.registerHoverProvider('ext.acme', hoverDescriptor({ surfaces: ['standard', 'study', 'reading'] }), fetch);

    await svc.fetchHover({ ...BASE_HOVER_REQ, surface: 'reading' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('required modifiers must ALL be present in the request', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const fetch = vi.fn().mockResolvedValue([]);
    svc.registerHoverProvider('ext.acme', hoverDescriptor({ modifiers: ['ctrl', 'alt'] }), fetch);

    await svc.fetchHover({ ...BASE_HOVER_REQ, modifiers: ['ctrl'] });
    expect(fetch).not.toHaveBeenCalled();

    await svc.fetchHover({ ...BASE_HOVER_REQ, modifiers: ['ctrl', 'alt', 'shift'] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('setExtensionEnabled(false) stops fetching from that extension\'s hover providers too, not just its decorators', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const fetch = vi.fn().mockResolvedValue([]);
    svc.registerHoverProvider('ext.acme', hoverDescriptor(), fetch);

    svc.setExtensionEnabled('ext.acme', false);
    await svc.fetchHover(BASE_HOVER_REQ);
    expect(fetch).not.toHaveBeenCalled();

    svc.setExtensionEnabled('ext.acme', true);
    await svc.fetchHover(BASE_HOVER_REQ);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('parallel fan-out: one provider throwing does not affect the others', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    svc.registerHoverProvider('ext.a', hoverDescriptor({ id: 'a' }), vi.fn().mockRejectedValue(new Error('boom')));
    svc.registerHoverProvider('ext.b', hoverDescriptor({ id: 'b' }), vi.fn().mockResolvedValue([{ kind: 'text', text: 'ok' }]));

    const res = await svc.fetchHover(BASE_HOVER_REQ);
    const byExt = new Map(res.results.map((r) => [r.extensionId, r]));
    expect(byExt.get('ext.a')?.status).toBe('error');
    expect(byExt.get('ext.a')?.content).toEqual([]);
    expect(byExt.get('ext.b')?.status).toBe('ok');
    expect(byExt.get('ext.b')?.content).toEqual([{ kind: 'text', text: 'ok' }]);
  });

  it('classifies an RpcTimeoutError-named error as status "timeout"', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const err = new Error('timed out');
    err.name = 'RpcTimeoutError';
    svc.registerHoverProvider('ext.a', hoverDescriptor(), vi.fn().mockRejectedValue(err));

    const res = await svc.fetchHover(BASE_HOVER_REQ);
    expect(res.results[0].status).toBe('timeout');
  });

  it('drops malformed hover content and caps the rest at 8', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const raw = [
      { kind: 'text', text: 'ok1' },
      { kind: 'bogus', text: 'nope' },
      ...Array.from({ length: 10 }, (_, i) => ({ kind: 'text', text: `extra${i}` })),
    ];
    svc.registerHoverProvider('ext.a', hoverDescriptor(), vi.fn().mockResolvedValue(raw));

    const res = await svc.fetchHover(BASE_HOVER_REQ);
    expect(res.results[0].status).toBe('ok');
    expect(res.results[0].content.length).toBe(8);
    expect(res.results[0].content.every((c) => c.kind === 'text')).toBe(true);
  });

  it('includes title only when the descriptor has one', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    svc.registerHoverProvider('ext.a', hoverDescriptor({ title: 'My Hover' }), vi.fn().mockResolvedValue([]));
    svc.registerHoverProvider('ext.b', hoverDescriptor({ id: 'b' }), vi.fn().mockResolvedValue([]));

    const res = await svc.fetchHover(BASE_HOVER_REQ);
    const byExt = new Map(res.results.map((r) => [r.extensionId, r]));
    expect(byExt.get('ext.a')?.title).toBe('My Hover');
    expect(byExt.get('ext.b')?.title).toBeUndefined();
  });
});

describe('VerseDecorationService.fetchHover - backoff (design doc §5.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('backs off after a failure, skipping without calling fetch until the window elapses', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const fetch = vi.fn().mockRejectedValue(new Error('boom'));
    svc.registerHoverProvider('ext.a', hoverDescriptor(), fetch);

    await svc.fetchHover(BASE_HOVER_REQ);
    expect(fetch).toHaveBeenCalledTimes(1);

    // Still within the 30s backoff window - skipped, no new call.
    vi.setSystemTime(10_000);
    const skipped = await svc.fetchHover(BASE_HOVER_REQ);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(skipped.results[0].status).toBe('skipped');

    // Past the 30s window - tries again.
    vi.setSystemTime(31_000);
    await svc.fetchHover(BASE_HOVER_REQ);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resets backoff to zero on success', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    let shouldFail = true;
    const fetch = vi.fn().mockImplementation(() => (shouldFail ? Promise.reject(new Error('boom')) : Promise.resolve([])));
    svc.registerHoverProvider('ext.a', hoverDescriptor(), fetch);

    await svc.fetchHover(BASE_HOVER_REQ); // fails, consecutive=1, backoff 30s
    shouldFail = false;
    vi.setSystemTime(31_000);
    await svc.fetchHover(BASE_HOVER_REQ); // succeeds, resets

    shouldFail = true;
    vi.setSystemTime(31_001); // immediately after success - no backoff window active
    await svc.fetchHover(BASE_HOVER_REQ);
    expect(fetch).toHaveBeenCalledTimes(3); // not skipped
  });

  it('notifies verseHoverLayerDegraded after 5 consecutive failures', async () => {
    const notifier = fakeNotifier();
    const svc = new VerseDecorationService(notifier);
    const fetch = vi.fn().mockRejectedValue(new Error('boom'));
    svc.registerHoverProvider('ext.a', hoverDescriptor(), fetch);

    // BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 300_000] (caps at the last step).
    let now = 0;
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(now);
      await svc.fetchHover(BASE_HOVER_REQ);
      now += 300_001; // always past whatever the current backoff window is
    }

    const degraded = notifier.calls.filter((c) => c.op === 'verseHoverLayerDegraded');
    expect(degraded).toHaveLength(1);
    expect(degraded[0].args[0]).toMatchObject({ extensionId: 'ext.a', hoverId: 'hover1' });
  });
});

describe('VerseDecorationService.fetch (decorators) - unaffected by the hover refactor', () => {
  it('still calls decorateEndpoint once per fetch with one DecorationRequestDto', async () => {
    const svc = new VerseDecorationService(fakeNotifier());
    const fetch = vi.fn().mockResolvedValue([]);
    svc.registerDecorator('ext.acme', decoratorDescriptor(), fetch);

    await svc.fetch({ startVerseId: 1001001, endVerseId: 1001031, moduleId: 1, moduleAbbrev: 'kjv', revisions: {} });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toMatchObject({ startVerseId: 1001001, endVerseId: 1001031, moduleId: 1, moduleAbbrev: 'kjv' });
  });
});
