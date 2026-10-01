import { describe, it, expect, vi } from 'vitest';
import { routeNotificationTarget } from './useNotificationOpenTarget';

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
