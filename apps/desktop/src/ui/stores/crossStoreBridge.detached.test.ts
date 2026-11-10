import { describe, it, expect, vi, afterEach } from 'vitest';
import { navigateToVerseInPrimary, previewVerseInPrimary, setNavigateToVerseInPrimary } from './crossStoreBridge';

type Win = { electron?: { window?: Record<string, unknown> } };

describe('scripture links in a popped-out window', () => {
  const original = (window as unknown as Win).electron;
  afterEach(() => {
    (window as unknown as Win).electron = original;
    history.pushState({}, '', '/');
    setNavigateToVerseInPrimary(null);
  });

  it('asks the main window to open the passage when no Bible pane is wired here', () => {
    const navigateMainToVerse = vi.fn().mockResolvedValue({ success: true });
    (window as unknown as Win).electron = { window: { navigateMainToVerse } };
    history.pushState({}, '', '/renderer/detached.html');
    navigateToVerseInPrimary(43003016);
    previewVerseInPrimary(45005008);
    expect(navigateMainToVerse.mock.calls).toEqual([[43003016], [45005008]]);
  });

  it('does nothing extra in the main window, where the bridge is wired', () => {
    const navigateMainToVerse = vi.fn().mockResolvedValue({ success: true });
    (window as unknown as Win).electron = { window: { navigateMainToVerse } };
    const nav = vi.fn();
    setNavigateToVerseInPrimary(nav);
    navigateToVerseInPrimary(43003016);
    expect(nav).toHaveBeenCalledWith(43003016);
    expect(navigateMainToVerse).not.toHaveBeenCalled();
  });
});
