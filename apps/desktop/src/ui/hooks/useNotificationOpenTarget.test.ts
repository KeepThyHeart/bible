import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { routeNotificationTarget, useNotificationOpenTarget } from './useNotificationOpenTarget';

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

  it('ignores unknown routes and extension targets', () => {
    const h = make();
    routeNotificationTarget({ kind: 'route', route: 'nowhere' }, h);
    routeNotificationTarget({ kind: 'extension', extensionId: 'x' }, h);
    expect(h.navigateToVerse).not.toHaveBeenCalled();
    expect(h.openNotificationPreferences).not.toHaveBeenCalled();
  });
});

describe('useNotificationOpenTarget', () => {
  const original = (window as { electron?: unknown }).electron;
  afterEach(() => {
    (window as { electron?: unknown }).electron = original;
  });

  it('picks up a click-through that arrived before it subscribed', async () => {
    const takeOpenTarget = vi.fn().mockResolvedValue({ kind: 'verse', verseId: 42 });
    const off = vi.fn();
    (window as { electron?: unknown }).electron = { notifications: { onOpenTarget: vi.fn(() => off), takeOpenTarget } };
    const handlers = { navigateToVerse: vi.fn(), openNotificationPreferences: vi.fn() };
    const { unmount } = renderHook(() => useNotificationOpenTarget(handlers));
    await waitFor(() => expect(handlers.navigateToVerse).toHaveBeenCalledWith(42, undefined));
    expect(takeOpenTarget).toHaveBeenCalledTimes(1);
    unmount();
    expect(off).toHaveBeenCalled();
  });
});
