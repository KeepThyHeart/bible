/**
 * 0209 W3: the "Ideas search unavailable" toast is a live region, times out on its own,
 * and does not swallow pointer events meant for the content underneath.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('../../hooks/useLocalizer', () => ({
  useLocalizer: () => ({ formatNumber: (n: number) => String(n) }),
}));
vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

let mockInit: { status: string; stage: string; detail: string } = { status: 'error', stage: 'error', detail: '' };
vi.mock('../../stores/searchStore', () => ({
  searchStore: {
    get semanticInit() { return mockInit; },
    get semanticInitDismissed() { return false; },
    dismissSemanticInit: vi.fn(),
  },
}));

import { SemanticSearchLoadingOverlay, UNAVAILABLE_TOAST_MS } from './SemanticSearchLoadingOverlay';

describe('SemanticSearchLoadingOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInit = { status: 'error', stage: 'error', detail: '' };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('announces the error as an alert and lets clicks through to the content underneath', () => {
    const { container } = render(<SemanticSearchLoadingOverlay />);
    const toast = container.querySelector<HTMLElement>('.semantic-loading')!;
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.style.pointerEvents).toBe('none');
    expect(screen.getByRole('button', { name: 'semanticSearchLoadingOverlay.dismiss' }).style.pointerEvents).toBe('auto');
  });

  it('goes away by itself after the timeout', () => {
    const { container } = render(<SemanticSearchLoadingOverlay />);
    expect(container.querySelector('.semantic-loading')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(UNAVAILABLE_TOAST_MS + 50); });
    expect(container.querySelector('.semantic-loading')).toBeNull();
  });

  it('keeps the loading state as a polite status that takes pointer events', () => {
    mockInit = { status: 'initializing', stage: 'model', detail: '' };
    const { container } = render(<SemanticSearchLoadingOverlay />);
    const toast = container.querySelector<HTMLElement>('.semantic-loading')!;
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.style.pointerEvents).toBe('');
  });
});
