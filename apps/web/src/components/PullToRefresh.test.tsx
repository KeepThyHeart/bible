/**
 * Component tests for PullToRefresh.
 *
 * Pattern: Component with touch event handling and visual state machine.
 * Tests verify: initial rendering, children are rendered, CSS classes,
 * and that the onRefresh callback is triggered after a sufficient pull gesture.
 *
 * Note: Touch events are dispatched directly on the container element since
 * the component wires listeners via addEventListener (not JSX event props).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/preact';
import { PullToRefresh } from './PullToRefresh';

/** Helper to create and dispatch a TouchEvent with one touch point. */
function touch(el: Element, type: string, clientY: number) {
  const event = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: [{ clientY } as Touch],
    changedTouches: [{ clientY } as Touch],
  });
  el.dispatchEvent(event);
}

describe('PullToRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders children', () => {
    render(
      <PullToRefresh>
        <div data-testid="inner">Inner content</div>
      </PullToRefresh>,
    );

    expect(screen.getByTestId('inner')).toBeTruthy();
    expect(screen.getByText('Inner content')).toBeTruthy();
  });

  it('passes className to the container element', () => {
    const { container } = render(
      <PullToRefresh class="my-scroll-container">
        <div>content</div>
      </PullToRefresh>,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('my-scroll-container');
  });

  it('renders the pull-to-refresh indicator in idle state initially', () => {
    const { container } = render(
      <PullToRefresh>
        <div>content</div>
      </PullToRefresh>,
    );

    const indicator = container.querySelector('.pull-to-refresh');
    expect(indicator).toBeTruthy();
    // In idle state, no pulling/ready/refreshing classes
    expect(container.querySelector('.pull-to-refresh--pulling')).toBeNull();
    expect(container.querySelector('.pull-to-refresh--ready')).toBeNull();
    expect(container.querySelector('.pull-to-refresh--refreshing')).toBeNull();
  });

  it('shows "Pull to refresh" text while pulling (below threshold)', () => {
    const { container } = render(
      <PullToRefresh threshold={64}>
        <div>content</div>
      </PullToRefresh>,
    );

    const wrapper = container.firstElementChild as HTMLElement;

    act(() => {
      touch(wrapper, 'touchstart', 100);
      touch(wrapper, 'touchmove', 150); // 50px dy * 0.4 = 20px < 64 threshold
    });

    expect(container.querySelector('.pull-to-refresh--pulling')).toBeTruthy();
    expect(screen.getByText('Pull to refresh')).toBeTruthy();
  });

  it('shows "Release to refresh" text when past threshold', () => {
    const { container } = render(
      <PullToRefresh threshold={64}>
        <div>content</div>
      </PullToRefresh>,
    );

    const wrapper = container.firstElementChild as HTMLElement;

    act(() => {
      touch(wrapper, 'touchstart', 100);
      // 200px dy * 0.4 = 80px > 64 threshold
      touch(wrapper, 'touchmove', 300);
    });

    expect(container.querySelector('.pull-to-refresh--ready')).toBeTruthy();
    expect(screen.getByText('Release to refresh')).toBeTruthy();
  });

  it('calls onRefresh when pull completes past threshold', () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <PullToRefresh threshold={64} onRefresh={onRefresh}>
        <div>content</div>
      </PullToRefresh>,
    );

    const wrapper = container.firstElementChild as HTMLElement;

    act(() => {
      touch(wrapper, 'touchstart', 100);
      touch(wrapper, 'touchmove', 300); // 80px dampened, > 64 threshold
      touch(wrapper, 'touchend', 300);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not call onRefresh when pull is below threshold', () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <PullToRefresh threshold={64} onRefresh={onRefresh}>
        <div>content</div>
      </PullToRefresh>,
    );

    const wrapper = container.firstElementChild as HTMLElement;

    act(() => {
      touch(wrapper, 'touchstart', 100);
      touch(wrapper, 'touchmove', 130); // 30 * 0.4 = 12px < 64 threshold
      touch(wrapper, 'touchend', 130);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('resets to idle after release without threshold', () => {
    const { container } = render(
      <PullToRefresh threshold={64}>
        <div>content</div>
      </PullToRefresh>,
    );

    const wrapper = container.firstElementChild as HTMLElement;

    act(() => {
      touch(wrapper, 'touchstart', 100);
      touch(wrapper, 'touchmove', 130); // below threshold
      touch(wrapper, 'touchend', 130);
    });

    // After sub-threshold release, indicator should be idle (no pulling classes)
    expect(container.querySelector('.pull-to-refresh--pulling')).toBeNull();
    expect(container.querySelector('.pull-to-refresh--ready')).toBeNull();
  });

  it('shows refreshing state after threshold pull and release', () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <PullToRefresh threshold={64} onRefresh={onRefresh}>
        <div>content</div>
      </PullToRefresh>,
    );

    const wrapper = container.firstElementChild as HTMLElement;

    act(() => {
      touch(wrapper, 'touchstart', 100);
      touch(wrapper, 'touchmove', 300); // above threshold
      touch(wrapper, 'touchend', 300);
    });

    expect(container.querySelector('.pull-to-refresh--refreshing')).toBeTruthy();
    expect(screen.getByText('Refreshing...')).toBeTruthy();
  });

  it('returns to idle after refreshing timeout', () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <PullToRefresh threshold={64} onRefresh={onRefresh}>
        <div>content</div>
      </PullToRefresh>,
    );

    const wrapper = container.firstElementChild as HTMLElement;

    act(() => {
      touch(wrapper, 'touchstart', 100);
      touch(wrapper, 'touchmove', 300);
      touch(wrapper, 'touchend', 300);
    });

    // After 2000ms timeout, resets to idle
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(container.querySelector('.pull-to-refresh--refreshing')).toBeNull();
  });

  it('cancels pulling when user swipes up (negative dy)', () => {
    const { container } = render(
      <PullToRefresh threshold={64}>
        <div>content</div>
      </PullToRefresh>,
    );

    const wrapper = container.firstElementChild as HTMLElement;

    act(() => {
      touch(wrapper, 'touchstart', 200);
      touch(wrapper, 'touchmove', 150); // negative dy — scrolling up
    });

    // Should cancel and remain idle
    expect(container.querySelector('.pull-to-refresh--pulling')).toBeNull();
  });

  it('renders the spinner div in refreshing state', () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <PullToRefresh threshold={64} onRefresh={onRefresh}>
        <div>content</div>
      </PullToRefresh>,
    );

    const wrapper = container.firstElementChild as HTMLElement;

    act(() => {
      touch(wrapper, 'touchstart', 100);
      touch(wrapper, 'touchmove', 300);
      touch(wrapper, 'touchend', 300);
    });

    expect(container.querySelector('.pull-to-refresh__spinner')).toBeTruthy();
  });
});
