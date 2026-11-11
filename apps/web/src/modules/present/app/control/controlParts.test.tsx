import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/preact';

const h = vi.hoisted(() => ({
  state: { display: { theme: 'dark', fontStep: 5, blanked: false }, session: { joinsLocked: false }, live: null } as Record<string, any>,
  send: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => (o && typeof o === 'object' && o.defaultValue) || key }),
}));
vi.mock('../../../../hooks/useStore', () => ({ useStore: (_s: unknown, sel: () => unknown) => sel() }));
vi.mock('../../stores/presentStore', () => ({ presentStore: { acceptClickerKeys: true, setAcceptClickerKeys: vi.fn(), send: vi.fn() } }));
vi.mock('../presenterSink', () => ({
  presenterSend: h.send,
  presenterShow: vi.fn(),
  presenterToggleBlank: vi.fn(),
  presenterIsLive: () => false,
  usePresenterState: () => h.state,
}));
vi.mock('../../study/usePresenterShortcuts', () => ({ stepWall: vi.fn() }));
vi.mock('../../../../utils/apiUrl', () => ({ API_BASE: '' }));
vi.mock('../../lib/controlLink', () => ({ buildViewerLink: (c: string) => `https://x/${c}`, buildControlLink: () => 'ctl', typedWatchAddress: () => 'x/watch' }));
vi.mock('./HelpTip', () => ({ HelpTip: () => null }));

import { JoinSection, ScreenSection } from './sections';
import { Transport } from './Transport';

// 0209 R2 W7 items 10 and 12: pressed states, labelled value, one cue per toggle, "Copied" feedback.
describe('ScreenSection', () => {
  it('marks the current theme as pressed and the others not', () => {
    const { getByText } = render(<ScreenSection />);
    expect(getByText('present.themeDark').getAttribute('aria-pressed')).toBe('true');
    expect(getByText('present.themeLight').getAttribute('aria-pressed')).toBe('false');
    expect(getByText('present.themeMax').getAttribute('aria-pressed')).toBe('false');
  });

  it('labels the text size value', () => {
    const { container } = render(<ScreenSection />);
    const out = container.querySelector('output')!;
    expect(out.textContent).toBe('5');
    expect(out.getAttribute('aria-label')).toBe('present.textSize');
  });
});

describe('Transport blank toggle', () => {
  it('keeps one name and signals the state with aria-pressed', () => {
    h.state.display.blanked = false;
    const { container, rerender } = render(<Transport />);
    const blank = () => container.querySelector<HTMLElement>('.pz-transport__btn--blank')!;
    const name = blank().getAttribute('aria-label');
    expect(blank().getAttribute('aria-pressed')).toBe('false');
    h.state.display.blanked = true;
    rerender(<Transport />);
    expect(blank().getAttribute('aria-label')).toBe(name);
    expect(blank().getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Transport labels', () => {
  it('shows visible text beside the icons', () => {
    h.state.display.blanked = false;
    const { container } = render(<Transport />);
    const labels = Array.from(container.querySelectorAll('.pz-transport__label')).map((n) => n.textContent);
    expect(labels).toEqual(['Back', 'Hide screen', 'Next']);
    h.state.display.blanked = true;
    const again = render(<Transport />);
    expect(again.container.querySelectorAll('.pz-transport__label')[1].textContent).toBe('Show screen');
  });
});

describe('Copy link', () => {
  const real = navigator.clipboard;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'clipboard', { value: real, configurable: true });
  });

  it('shows Copied and announces it, falling back to execCommand when the clipboard API is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    (document as any).execCommand = vi.fn(() => true);
    const { getByText, container } = render(<JoinSection session={{ joinCode: 'ABCD', sessionId: 's', controlToken: 't' } as any} />);
    await act(async () => { fireEvent.click(getByText('present.copyLink')); });
    expect(getByText('present.copied', { selector: 'button' })).toBeTruthy();
    expect(container.querySelector('[role="status"]')!.textContent).toBe('present.copied');
    expect((document as any).execCommand).toHaveBeenCalledWith('copy');
  });
});
