import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const dispose = vi.hoisted(() => vi.fn());
const showCards = vi.hoisted(() => vi.fn());
const setActiveReference = vi.hoisted(() => vi.fn());
const mountMemoryUi = vi.hoisted(() => vi.fn(() => ({ dispose, showCards, setActiveReference })));
const openApp = vi.hoisted(() => vi.fn());

vi.mock('@bible/memory/ui', () => ({ mountMemoryUi }));
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => `[${k}]`, i18n: { resolve: () => '?', currentLocale: 'en' } }),
}));
vi.mock('../moduleHost', () => ({ featureModules: { isEnabled: () => false } }));
vi.mock('../../apps/appHost', () => ({ appRegistry: { get: () => undefined, setBadge: vi.fn() }, openApp, addAppBinding: vi.fn(), verseActions: { bindHandler: vi.fn() } }));
vi.mock('./memoryClient', () => ({ memoryClient: { on: vi.fn(() => vi.fn()) } }));

import { MemoryAppView } from './MemoryAppView';
import { requestMemoryCards } from './memoryModule';
import { publishActiveVerseBroadcast } from '../../extensions/activeVerseBroadcast';

beforeEach(() => vi.clearAllMocks());

describe('MemoryAppView', () => {
  it('mounts the UI into its container and disposes on unmount', () => {
    const { unmount } = render(<MemoryAppView />);
    expect(mountMemoryUi).toHaveBeenCalledTimes(1);
    const [container, options] = mountMemoryUi.mock.calls[0] as unknown as [HTMLElement, { initialView: string }];
    expect(container.tagName).toBe('DIV');
    expect(options.initialView).toBe('plan');
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('opens on the cards when a request was pending, and reacts to later requests', () => {
    requestMemoryCards();
    render(<MemoryAppView />);
    expect((mountMemoryUi.mock.calls[0] as unknown as [unknown, { initialView: string }])[1].initialView).toBe('card');
    requestMemoryCards();
    expect(showCards).toHaveBeenCalledTimes(1);
  });

  it('forwards the reader\'s active verse', () => {
    render(<MemoryAppView />);
    publishActiveVerseBroadcast({ verseId: 43003016 });
    expect(setActiveReference).toHaveBeenCalledWith(expect.stringContaining('3:16'));
  });

  it('has a heading and a Back button that opens Study', () => {
    render(<MemoryAppView />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /backToStudy|Back to Study/ }));
    expect(openApp).toHaveBeenCalledWith('study');
  });
});
