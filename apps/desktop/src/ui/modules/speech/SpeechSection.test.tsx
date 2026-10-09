import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const service = {
  status: vi.fn(),
  chosen: vi.fn(async () => 'base'),
  prepareModel: vi.fn(),
  removeModel: vi.fn(async () => undefined),
};
vi.mock('./bridgeHost', async () => {
  const actual = await vi.importActual<typeof import('./bridgeHost')>('./bridgeHost');
  return { ...actual, getSpeechService: async () => service };
});
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));

import { SpeechSection, levelOf } from './SpeechSection';

beforeEach(() => {
  window.localStorage.clear();
  service.status.mockReset().mockResolvedValue({ listen: 'needs-download' });
  service.prepareModel.mockReset();
  service.removeModel.mockClear();
});

describe('SpeechSection', () => {
  it('downloads the chosen model with progress and then offers delete', async () => {
    service.prepareModel.mockImplementation(async (_id: string, onProgress: (p: unknown) => void) => {
      onProgress({ loaded: 50, total: 100 });
      service.status.mockResolvedValue({ listen: 'ready' });
    });
    render(<SpeechSection />);
    fireEvent.click(await screen.findByTestId('speech-download'));
    await waitFor(() => expect(service.prepareModel).toHaveBeenCalledWith('base', expect.any(Function), expect.any(AbortSignal)));
    fireEvent.click(await screen.findByTestId('speech-delete'));
    await waitFor(() => expect(service.removeModel).toHaveBeenCalledWith('base'));
  });

  it('cancel aborts the download without showing an error', async () => {
    service.prepareModel.mockImplementation((_id: string, _p: unknown, signal: AbortSignal) =>
      new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))));
    render(<SpeechSection />);
    fireEvent.click(await screen.findByTestId('speech-download'));
    fireEvent.click(await screen.findByTestId('speech-cancel'));
    await screen.findByTestId('speech-download');
    expect(screen.queryByTestId('speech-error')).toBeNull();
  });

  it('saves model and device choices', async () => {
    render(<SpeechSection />);
    await screen.findByTestId('speech-download');
    fireEvent.change(screen.getByTestId('speech-model'), { target: { value: 'tiny' } });
    fireEvent.change(screen.getByTestId('speech-device'), { target: { value: 'wasm' } });
    expect(JSON.parse(window.localStorage.getItem('kth.speech.prefs')!)).toEqual({ model: 'tiny', device: 'wasm' });
  });

  it('shows a download error', async () => {
    service.prepareModel.mockRejectedValue(new Error('offline'));
    render(<SpeechSection />);
    fireEvent.click(await screen.findByTestId('speech-download'));
    expect((await screen.findByTestId('speech-error')).textContent).toBe('offline');
  });
});

describe('levelOf', () => {
  it('is 0 for silence and grows with amplitude', () => {
    expect(levelOf(new Uint8Array(64).fill(128))).toBe(0);
    expect(levelOf(new Uint8Array(64).fill(255))).toBeGreaterThan(levelOf(new Uint8Array(64).fill(150)));
  });
});
