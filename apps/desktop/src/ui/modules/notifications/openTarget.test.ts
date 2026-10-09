import { describe, it, expect, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import {
  hostOpenTargetHandlers,
  OPEN_PREFERENCES_SECTION_EVENT,
  routeNotificationTarget,
  startNotificationOpenTargetRouting,
} from './openTarget';

describe('routeNotificationTarget', () => {
  const make = () => ({ navigateToVerse: vi.fn(), openNotificationPreferences: vi.fn() });

  it('navigates to a verse', () => {
    const h = make();
    routeNotificationTarget({ kind: 'verse', verseId: 1001001 }, h);
    expect(h.navigateToVerse).toHaveBeenCalledWith(1001001, undefined);
  });

  it('navigates to a verse range', () => {
    const h = make();
    routeNotificationTarget({ kind: 'verse', verseId: 5, endVerseId: 9 }, h);
    expect(h.navigateToVerse).toHaveBeenCalledWith(5, 9);
  });

  it('opens Preferences for settings/notifications', () => {
    const h = make();
    routeNotificationTarget({ kind: 'route', route: 'settings/notifications' }, h);
    expect(h.openNotificationPreferences).toHaveBeenCalledTimes(1);
  });

  it('routes desktop app links to openAppRoute', () => {
    const openAppRoute = vi.fn();
    const h = { ...make(), openAppRoute };
    routeNotificationTarget({ kind: 'route', route: 'app:memory/cards' }, h);
    routeNotificationTarget({ kind: 'route', route: 'app:memory' }, h);
    expect(openAppRoute).toHaveBeenNthCalledWith(1, 'memory', 'cards');
    expect(openAppRoute).toHaveBeenNthCalledWith(2, 'memory', '');
  });

  it('ignores an app link when no handler is given', () => {
    expect(() => routeNotificationTarget({ kind: 'route', route: 'app:memory/cards' }, make())).not.toThrow();
  });

  it('ignores unknown routes and extension targets', () => {
    const h = make();
    routeNotificationTarget({ kind: 'route', route: 'nowhere' }, h);
    routeNotificationTarget({ kind: 'extension', extensionId: 'x' }, h);
    expect(h.navigateToVerse).not.toHaveBeenCalled();
    expect(h.openNotificationPreferences).not.toHaveBeenCalled();
  });
});

describe('startNotificationOpenTargetRouting', () => {
  const handlers = () => ({ navigateToVerse: vi.fn(), openNotificationPreferences: vi.fn() });

  it('picks up a click-through that arrived before it subscribed, once', async () => {
    const takeOpenTarget = vi.fn().mockResolvedValue({ kind: 'verse', verseId: 42 });
    const off = vi.fn();
    const on = vi.fn(() => off);
    const h = handlers();
    const sub = startNotificationOpenTargetRouting(h, { on, takeOpenTarget } as never);
    await waitFor(() => expect(h.navigateToVerse).toHaveBeenCalledWith(42, undefined));
    expect(takeOpenTarget).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith('open-target', expect.any(Function));
    sub.dispose();
    expect(off).toHaveBeenCalled();
  });

  it('routes an open-target event', () => {
    let cb: ((t: unknown) => void) | undefined;
    const on = vi.fn((_e: string, fn: (t: unknown) => void) => { cb = fn; return vi.fn(); });
    const h = handlers();
    startNotificationOpenTargetRouting(h, { on, takeOpenTarget: vi.fn().mockResolvedValue(null) } as never);
    cb?.({ kind: 'route', route: 'settings/notifications' });
    expect(h.openNotificationPreferences).toHaveBeenCalledTimes(1);
  });

  it('does nothing without the module bridge (not in Electron)', () => {
    const h = handlers();
    const on = vi.fn(() => { throw new Error('Feature module bridge not available'); });
    const sub = startNotificationOpenTargetRouting(h, { on, takeOpenTarget: vi.fn() } as never);
    expect(() => sub.dispose()).not.toThrow();
  });

  it('the host handlers open Preferences through a window event', () => {
    const seen = vi.fn();
    window.addEventListener(OPEN_PREFERENCES_SECTION_EVENT, seen);
    hostOpenTargetHandlers.openNotificationPreferences();
    window.removeEventListener(OPEN_PREFERENCES_SECTION_EVENT, seen);
    expect((seen.mock.calls[0]![0] as CustomEvent).detail).toBe('notifications');
  });
});
