import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('./audio/AudioVersePane', () => ({ AudioVersePane: () => <div data-testid="verse-pane" /> }));
vi.mock('./audio/AudioQuickSettings', () => ({ AudioQuickSettings: () => <div data-testid="quick-settings" /> }));
vi.mock('./audio/AudioSpeedControl', () => ({ AudioSpeedControl: () => <div data-testid="speed-control" /> }));
vi.mock('./audio/AudioStatusLine', () => ({ AudioStatusLine: () => null }));
vi.mock('./audio/AudioProgress', () => ({ AudioProgress: () => null }));
vi.mock('./audio/AudioTransportButtons', () => ({ AudioTransportButtons: () => <div /> }));
vi.mock('./audio/useSources', () => ({ useSources: () => [] }));
vi.mock('../hooks/useNowPlaying', () => ({
  useNowPlaying: () => ({ moduleAbbr: 'KJV', refLabel: 'John 3', tab: null, verse: null, book: 43, chapter: 3 }),
}));
vi.mock('@bible/ui', () => ({
  BottomSheet: ({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: preact.ComponentChildren }) =>
    open ? <div role="dialog" aria-label={title}><button data-testid="sheet-close" onClick={onClose} />{children}</div> : null,
}));

import { audioStore } from '../stores/audioStore';
import { AudioPlayerScreen } from './AudioPlayerScreen';

describe('AudioPlayerScreen', () => {
  beforeEach(() => {
    audioStore.enabled = true;
    audioStore.setLayout('phone');
    audioStore.playerOpen = true;
    audioStore.quickSettingsOpen = false;
  });
  afterEach(() => { cleanup(); audioStore.playerOpen = false; audioStore.quickSettingsOpen = false; });

  it('has the speed control and stop, and no source chips', () => {
    const { container } = render(<AudioPlayerScreen />);
    expect(screen.getByTestId('speed-control')).toBeTruthy();
    expect(screen.getByTestId('audio-player-stop')).toBeTruthy();
    expect(container.querySelector('.audio-chip')).toBeNull();
    expect(screen.getByTestId('verse-pane')).toBeTruthy();
  });

  it('opens the sheet from the gear', () => {
    render(<AudioPlayerScreen />);
    expect(screen.queryByTestId('quick-settings')).toBeNull();
    fireEvent.click(screen.getByTestId('audio-player-gear'));
    expect(audioStore.quickSettingsOpen).toBe(true);
    expect(screen.getByTestId('quick-settings')).toBeTruthy();
  });

  it('Escape closes the sheet before the player', () => {
    render(<AudioPlayerScreen />);
    fireEvent.click(screen.getByTestId('audio-player-gear'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(audioStore.quickSettingsOpen).toBe(false);
    expect(audioStore.playerOpen).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(audioStore.playerOpen).toBe(false);
  });
});
