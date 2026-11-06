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

  it('the focus shortcut moves focus into the verse pane; Escape closes the player and returns focus', async () => {
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
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(outside);
    expect(audioStore.status).toBe('idle');
    expect(screen.queryByTestId('audio-popup')).toBeNull();
    outside.remove();
  });

  it('docking to the bar focuses the bar\'s first control', async () => {
    await start();
    render(<><AudioPlayerPopup /><AudioTransportBar /></>);
    await playNow();
    fireEvent.click(await screen.findByTestId('audio-dock'));
    await vi.waitFor(() => {
      const bar = screen.getByTestId('audio-transport');
      expect(bar.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  it('a no-recording error disables the transport, hides the source chip and clears the error on stop', async () => {
    await start();
    render(<AudioPlayerPopup />);
    await playNow();
    await screen.findByTestId('audio-popup');
    const s = audioStore as unknown as { status: string; notice: unknown; notify(): void };
    s.status = 'error';
    s.notice = { key: 'audio.error.not-found', tone: 'error', actions: [] };
    s.notify();
    await flush();
    expect(screen.getByTestId('audio-play-pause').hasAttribute('disabled')).toBe(true);
    expect((screen.getByTestId('audio-progress') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByTestId('audio-popup-sub')).toBeNull();
    audioStore.stop();
    expect(audioStore.notice).toBeNull();
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
