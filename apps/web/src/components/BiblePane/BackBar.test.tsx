/**
 * Component tests for BackBar.
 *
 * Pattern: Store-connected component with conditional rendering.
 * A minimal BibleStore stub (extending the real Store class for subscription support)
 * is injected via vi.mock so that useStore reacts to state changes normally.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { Store } from '../../stores/Store';

// ---------------------------------------------------------------------------
// Stub store — must be created before vi.mock calls are hoisted.
// vi.hoisted() runs before hoisted vi.mock() factories.
// ---------------------------------------------------------------------------

// BackBar localizes its dismiss tooltip, so the hook needs stubbing like
// everywhere else in these tests.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => enString(key),
    i18n: { language: 'en' },
  }),
}));

const { stubBibleStore } = vi.hoisted(() => {
  // We can't import Store here (hoisting), so we replicate the minimal API inline.
  class StubBibleStore {
    private listeners = new Set<() => void>();
    _showBackBar = false;
    _backLabel: string | null = null;

    getActiveTab() { return { showBackBar: this._showBackBar }; }
    getBackLabel() { return this._backLabel; }
    goBack = vi.fn();
    dismissBackBar = vi.fn();

    subscribe(fn: () => void) {
      this.listeners.add(fn);
      return () => { this.listeners.delete(fn); };
    }

    notify() {
      this.listeners.forEach(fn => fn());
    }
  }

  return { stubBibleStore: new StubBibleStore() };
});

vi.mock('../../stores/bibleStore', () => ({ bibleStore: stubBibleStore }));

import { BackBar } from './BackBar';
import { enString } from '../../testing/enCatalog';

// Helper
function setState(showBackBar: boolean, backLabel: string | null) {
  stubBibleStore._showBackBar = showBackBar;
  stubBibleStore._backLabel = backLabel;
  stubBibleStore.notify();
}

describe('BackBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubBibleStore._showBackBar = false;
    stubBibleStore._backLabel = null;
    stubBibleStore.goBack.mockReset();
    stubBibleStore.dismissBackBar.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when showBackBar is false', () => {
    const { container } = render(<BackBar />);
    expect(container.querySelector('.bible-back-bar')).toBeNull();
  });

  it('renders nothing when showBackBar is true but backLabel is null', () => {
    stubBibleStore._showBackBar = true;
    stubBibleStore._backLabel = null;
    const { container } = render(<BackBar />);
    expect(container.querySelector('.bible-back-bar')).toBeNull();
  });

  it('renders the back bar when showBackBar is true and backLabel is set', () => {
    stubBibleStore._showBackBar = true;
    stubBibleStore._backLabel = 'Genesis 1';
    const { container } = render(<BackBar />);
    expect(container.querySelector('.bible-back-bar')).toBeTruthy();
  });

  it('renders the back label in the button text', () => {
    stubBibleStore._showBackBar = true;
    stubBibleStore._backLabel = 'John 3';
    render(<BackBar />);
    expect(screen.getByText(/Back to John 3/)).toBeTruthy();
  });

  it('calls bibleStore.goBack when back button is clicked', () => {
    stubBibleStore._showBackBar = true;
    stubBibleStore._backLabel = 'Psalm 23';
    const { container } = render(<BackBar />);
    fireEvent.click(container.querySelector('.bible-back-bar__btn')!);
    expect(stubBibleStore.goBack).toHaveBeenCalledTimes(1);
  });

  it('calls bibleStore.dismissBackBar when dismiss button is clicked', () => {
    stubBibleStore._showBackBar = true;
    stubBibleStore._backLabel = 'Romans 8';
    const { container } = render(<BackBar />);
    fireEvent.click(container.querySelector('.bible-back-bar__dismiss')!);
    expect(stubBibleStore.dismissBackBar).toHaveBeenCalledTimes(1);
  });

  it('dismiss button has title="Dismiss"', () => {
    stubBibleStore._showBackBar = true;
    stubBibleStore._backLabel = 'Romans 8';
    const { container } = render(<BackBar />);
    const btn = container.querySelector('.bible-back-bar__dismiss') as HTMLElement;
    expect(btn.title).toBe('Dismiss');
  });

  it('does not have fading class initially', () => {
    stubBibleStore._showBackBar = true;
    stubBibleStore._backLabel = 'Matthew 5';
    const { container } = render(<BackBar />);
    expect(container.querySelector('.bible-back-bar--fading')).toBeNull();
  });

  it('applies fading class after 30 seconds', () => {
    stubBibleStore._showBackBar = true;
    stubBibleStore._backLabel = 'Luke 2';
    const { container } = render(<BackBar />);
    expect(container.querySelector('.bible-back-bar--fading')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(container.querySelector('.bible-back-bar--fading')).toBeTruthy();
  });

  it('calls dismissBackBar after the 30s + 500ms auto-dismiss timer', () => {
    stubBibleStore._showBackBar = true;
    stubBibleStore._backLabel = 'Acts 2';
    render(<BackBar />);

    act(() => {
      vi.advanceTimersByTime(30500);
    });
    expect(stubBibleStore.dismissBackBar).toHaveBeenCalledTimes(1);
  });

  it('shows the back bar after a store update notification', () => {
    const { container } = render(<BackBar />);
    expect(container.querySelector('.bible-back-bar')).toBeNull();

    act(() => setState(true, 'Mark 1'));
    expect(container.querySelector('.bible-back-bar')).toBeTruthy();
  });
});
