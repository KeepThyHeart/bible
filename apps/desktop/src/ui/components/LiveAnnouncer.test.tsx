import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LiveAnnouncer as Inner } from './LiveAnnouncer';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { announce, __resetAnnouncerForTests } from '../services/announcer';

const services = {
  registry: {}, whenContext: {}, keybindings: {},
  i18n: {
    t: (key: string) => key, currentLocale: 'en', onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v), loadCatalog: vi.fn(), setLocale: vi.fn(),
  },
} as unknown as AppServices;
const LiveAnnouncer = () => <ContextProvider services={services}><Inner /></ContextProvider>;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  __resetAnnouncerForTests();
  vi.useRealTimers();
});
const text = () => screen.getByTestId('live-announcer').textContent;

describe('LiveAnnouncer (B-113)', () => {
  it('renders an always-present polite status region', () => {
    render(<LiveAnnouncer />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(text()).toBe('');
  });

  it('announces after the settle delay, batching and de-duplicating', () => {
    render(<LiveAnnouncer />);
    act(() => {
      announce('Romans 8');
      announce('Romans 8');
      announce('Highlight applied');
      vi.advanceTimersByTime(150 + 50);
    });
    expect(text()).toBe('Romans 8 Highlight applied');
  });

  it('re-speaks an identical message later and clears stale text after 7 s', () => {
    render(<LiveAnnouncer />);
    act(() => { announce('Dark'); vi.advanceTimersByTime(200); });
    expect(text()).toBe('Dark');
    act(() => { vi.advanceTimersByTime(300); announce('Dark'); vi.advanceTimersByTime(160); });
    expect(text()).toBe(''); // cleared first so the repeat is re-read
    act(() => { vi.advanceTimersByTime(50); });
    expect(text()).toBe('Dark');
    act(() => { vi.advanceTimersByTime(7000); });
    expect(text()).toBe('');
  });

  it('is a no-op without a mounted announcer', () => {
    expect(() => announce('nobody listening')).not.toThrow();
  });
});
