import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PresenterApp } from './PresenterApp';
import type { PresentStatus } from '../../../../electron/modules/present/types';

vi.mock('../../contexts/useI18n', () => ({ useI18n: () => ({ t: (key: string) => `[${key}]` }) }));
vi.mock('../host/useModuleNamespace', () => ({ useModuleNamespace: () => true }));
vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([{ abbreviation: 'KJV', name: 'King James' }]),
    getAllBooks: vi.fn().mockResolvedValue([
      { book_number: 42, book_name: 'Luke', chapter_count: 24 },
      { book_number: 43, book_name: 'John', chapter_count: 21 },
    ]),
  },
}));

const display = { fontStep: 0, blanked: false, theme: 'dark' as const };
const stopped: PresentStatus = { running: false, server: null, request: null, snapshot: { version: 0, live: null, display, viewerCount: 0 } };
const running = (extra: Partial<PresentStatus> = {}): PresentStatus => ({
  running: true,
  server: { url: 'http://127.0.0.1:5555/p/tok/', lanUrls: [], port: 5555, lan: false, qrSvg: '<svg/>' },
  request: null,
  snapshot: { version: 1, live: null, display, viewerCount: 0 },
  ...extra,
});

const calls: Array<[string, unknown[]]> = [];
let current: PresentStatus;
const handlers: Record<string, (...a: any[]) => PresentStatus | void> = {};
const listeners: Array<(s: PresentStatus) => void> = [];

beforeEach(() => {
  calls.length = 0;
  current = stopped;
  listeners.length = 0;
  Object.assign(handlers, {
    status: () => current,
    start: (opts?: { lan?: boolean }) => (current = running({ server: { ...running().server!, lan: opts?.lan === true, lanUrls: opts?.lan ? ['http://192.168.1.9:5555/p/tok/'] : [] } })),
    stop: () => (current = stopped),
    setPassage: (r: any) =>
      (current = running({
        request: r,
        snapshot: { version: 2, live: { reference: 'John 3', module: 'KJV', bookName: 'John', chapter: 3, verses: [{ verse: 1, text: 'There was a man' }, { verse: 2, text: 'The same came' }], focus: 1 }, display, viewerCount: 1 },
      })),
    step: () => current,
    focusVerse: () => current,
    setDisplay: () => current,
    openInBrowser: () => {},
    openInWindow: () => {},
  });
  (window as any).electron = {
    modules: {
      invoke: vi.fn(async (_ns: string, method: string, ...args: unknown[]) => {
        calls.push([method, args]);
        return { ok: true, value: handlers[method](...args) };
      }),
      on: vi.fn((_ns: string, _ev: string, cb: (s: PresentStatus) => void) => {
        listeners.push(cb);
        return () => {};
      }),
    },
  };
});

describe('PresenterApp', () => {
  it('offers to start, then shows the address and the pickers', async () => {
    const user = userEvent.setup();
    render(<PresenterApp />);
    await screen.findByTestId('present-intro');
    expect(screen.queryByTestId('present-url')).toBeNull();
    await user.click(screen.getByTestId('present-start-main'));
    expect(await screen.findByTestId('present-url')).toHaveValue('http://127.0.0.1:5555/p/tok/');
    expect(calls.find(([m]) => m === 'start')![1]).toEqual([{ lan: false }]);
    expect(screen.queryByTestId('present-qr')).toBeNull(); // no QR code in local mode
  });

  it('shows the warning and the QR code only in LAN mode', async () => {
    const user = userEvent.setup();
    render(<PresenterApp />);
    await user.click(await screen.findByTestId('present-lan'));
    expect(screen.getByRole('note')).toBeInTheDocument();
    await user.click(screen.getByTestId('present-start-main'));
    expect(await screen.findByTestId('present-qr')).toBeInTheDocument();
    expect(screen.getByTestId('present-lan-url')).toHaveTextContent('192.168.1.9');
  });

  it('sends the chosen passage, and the toolbar steps the screen', async () => {
    const user = userEvent.setup();
    render(<PresenterApp />);
    await user.click(await screen.findByTestId('present-start-main'));
    await screen.findByTestId('present-picker');
    await waitFor(() => expect(screen.getByTestId('present-module')).toHaveValue('KJV'));
    await user.clear(screen.getByTestId('present-from'));
    await user.type(screen.getByTestId('present-from'), '1');
    await user.click(screen.getByTestId('present-show'));
    expect(await screen.findByTestId('present-reference')).toHaveTextContent('John 3');
    expect(calls.find(([m]) => m === 'setPassage')![1][0]).toMatchObject({ module: 'KJV', book: 43, chapter: 3, verseStart: 1 });

    await user.click(screen.getByTestId('present-next'));
    await user.click(screen.getByTestId('present-prev'));
    await user.click(screen.getByTestId('present-verse-2'));
    expect(calls.filter(([m]) => m === 'step').map(([, a]) => a[0])).toEqual([1, -1]);
    expect(calls.find(([m]) => m === 'focusVerse')![1]).toEqual([2]);

    await user.click(screen.getByTestId('present-blank'));
    expect(calls.find(([m]) => m === 'setDisplay')![1]).toEqual([{ blanked: true }]);
    await user.click(screen.getByTestId('present-open-window'));
    expect(calls.some(([m]) => m === 'openInWindow')).toBe(true);
  });

  it('stops the presentation', async () => {
    const user = userEvent.setup();
    current = running();
    render(<PresenterApp />);
    await user.click(await screen.findByTestId('present-stop'));
    expect(await screen.findByTestId('present-intro')).toBeInTheDocument();
  });
});
