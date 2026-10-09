import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}${JSON.stringify(opts)}` : key),
    i18n: { language: 'en' },
  }),
}));
// Sibling components are built in parallel and have their own tests.
vi.mock('./AudioVersePane', () => ({ AudioVersePane: ({ variant }: { variant: string }) => <div data-testid="audio-verse-pane" tabIndex={0} data-variant={variant} /> }));
vi.mock('./AudioQuickSettings', () => ({ AudioQuickSettings: () => <div data-testid="quick-settings" /> }));
vi.mock('./AudioSpeedControl', () => ({ AudioSpeedControl: () => <div data-testid="speed" /> }));

import { audioStore } from '../audioStore';
import { buildUiRig, flush, openChapter } from '../lib/uiRig';
import { AudioPlayerPopup } from './AudioPlayerPopup';
import { AudioTransportBar } from './AudioTransportBar';
import { focusAudioPlayer } from '../lib/audioShortcuts';

async function start() {
  buildUiRig({});
  await openChapter();
  await flush();
}
async function playNow() {
  const p = audioStore.play();
  await flush();
  await p;
  await flush();
}

beforeEach(() => { audioStore.reset(); });
afterEach(() => { cleanup(); audioStore.reset(); });

describe('AudioPlayerPopup', () => {
  it('is absent while idle and shows as a non-modal dialog while playing, without taking focus', async () => {
    await start();
    render(<AudioPlayerPopup />);
    expect(screen.queryByTestId('audio-popup')).toBeNull();
    const before = document.activeElement;
    await playNow();
    const dlg = await screen.findByTestId('audio-popup');
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('false');
    expect(dlg.getAttribute('aria-labelledby')).toBe('audio-popup-title');
    expect(screen.getByTestId('audio-verse-pane').getAttribute('data-variant')).toBe('popup');
    expect(document.activeElement).toBe(before);
  });

  it('dock switches to the bar (and the bar takes over); stop closes it', async () => {
    await start();
    render(<><AudioPlayerPopup /><AudioTransportBar /></>);
    await playNow();
    await screen.findByTestId('audio-popup');
    expect(screen.queryByTestId('audio-transport')).toBeNull();
    fireEvent.click(screen.getByTestId('audio-dock'));
    expect(audioStore.prefs.playerStyle).toBe('bar');
    expect(screen.queryByTestId('audio-popup')).toBeNull();
    expect(screen.getByTestId('audio-transport')).toBeTruthy();
    fireEvent.click(screen.getByTestId('audio-popout'));
    expect(audioStore.prefs.playerStyle).toBe('popup');
    fireEvent.click(screen.getByTestId('audio-close'));
    await flush();
    expect(audioStore.status).toBe('idle');
    expect(screen.queryByTestId('audio-popup')).toBeNull();
  });

  it('the focus shortcut moves focus into the verse pane; Escape returns it and changes no state', async () => {
    await start();
    const outside = document.createElement('button');
    outside.setAttribute('data-testid', 'outside');
    document.body.appendChild(outside);
    render(<AudioPlayerPopup />);
    await playNow();
    await screen.findByTestId('audio-popup');
    outside.focus();
    focusAudioPlayer();
    expect(document.activeElement).toBe(screen.getByTestId('audio-verse-pane'));
    const status = audioStore.status;
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(outside);
    expect(audioStore.status).toBe(status);
    outside.remove();
  });
});

describe('AudioTransportBar styles', () => {
  it('idle notice shows in popup style too', async () => {
    await start();
    audioStore.notice = { key: 'audio.notice.noAudio', actions: [] } as never;
    (audioStore as unknown as { notify(): void }).notify();
    render(<AudioTransportBar />);
    expect(screen.getByTestId('audio-transport')).toBeTruthy();
  });
});
