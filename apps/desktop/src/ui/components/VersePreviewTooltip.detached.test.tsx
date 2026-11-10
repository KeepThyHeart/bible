/**
 * A popped-out notes window is its own renderer: no Bible tabs and an unloaded
 * module list. The hover preview must load the installed Bibles and use the
 * default one rather than reporting "Verse not found".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import VersePreviewTooltip from './VersePreviewTooltip';
import { useBibleStore } from '../stores/useBibleStore';
import { __clearVerseFetchCache } from '../services/verseFetchCache';

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: 'en', i18n: {} }),
}));
vi.mock('../stores/hooks/useBiblePanel', () => ({
  useBiblePanel: () => ({ openTabs: [], activeTabIndex: 0 }),
}));
vi.mock('../utils/verseReference', () => ({ loadBookNamesCache: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../utils/verseFormatting', () => ({ formatVerseReference: () => 'John 3:16' }));
const getVerses = vi.fn();
vi.mock('../services/electronAPI', () => ({
  bibleAPI: {
    getVerses: (...a: unknown[]) => getVerses(...a),
    getVerse: vi.fn().mockResolvedValue(null),
  },
}));

describe('VersePreviewTooltip in a detached window', () => {
  beforeEach(() => {
    __clearVerseFetchCache();
    getVerses.mockReset();
    getVerses.mockResolvedValue([
      { verse_id: 43003016, text: 'For God so loved the world', text_html: 'For God so loved the world' },
    ]);
  });

  it('resolves the default Bible after loading the module list', async () => {
    const loadAvailableBibles = vi.fn(async () => {
      useBibleStore.setState({ availableBibles: [{ abbreviation: 'KJV', language_code: 'en' } as never] });
    });
    useBibleStore.setState({ availableBibles: [], loadAvailableBibles } as never);
    render(<VersePreviewTooltip verseId={43003016} position={{ x: 0, y: 0 }} onClose={() => {}} />);
    await waitFor(() => expect(getVerses).toHaveBeenCalled());
    expect(getVerses.mock.calls[0][0]).toBe('KJV');
    expect(screen.queryByText('Verse not found')).toBeNull();
  });
});
