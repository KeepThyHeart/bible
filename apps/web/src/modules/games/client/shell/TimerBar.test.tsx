// @vitest-environment jsdom
/**
 * The one thing worth pinning down here: a pause has to actually stop the
 * bar. `endsAt` does not move while the room is paused (the server gives the
 * whole pause back on resume), but wall-clock time keeps moving underneath
 * it, and a bar that kept reading the clock during a pause would visibly
 * drain through it — which is exactly the glitch this file guards against.
 */

import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClockContext, type ClockPort } from './clockPort.js';
import { TimerBar } from './TimerBar.js';

let host: HTMLDivElement;
let msUntilReturn: number;
let rafCallbacks: FrameRequestCallback[];

const clock: ClockPort = {
  serverNow: () => 0,
  msUntil: () => msUntilReturn,
  showAt: () => () => undefined,
  report: () => null,
  onChange: () => () => undefined,
};

function draw(paused: boolean): void {
  act(() => {
    render(
      <ClockContext.Provider value={clock}>
        <TimerBar endsAt={10_000} durationMs={10_000} paused={paused} />
      </ClockContext.Provider>,
      host
    );
  });
}

function fillPercent(): number {
  const el = host.querySelector('.timerbar-fill') as HTMLElement | null;
  return el ? parseFloat(el.style.width) : NaN;
}

/** Runs every animation frame queued so far, as the browser would the next paint. */
function fireFrame(): void {
  act(() => {
    const due = [...rafCallbacks];
    rafCallbacks = [];
    for (const callback of due) callback(0);
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  msUntilReturn = 10_000;
  rafCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe('the timer bar while paused', () => {
  it('freezes the fill at the moment pause began, ignoring the clock after that', () => {
    draw(false);
    msUntilReturn = 7_000;
    fireFrame();
    expect(fillPercent()).toBe(70);

    draw(true);
    // Time keeps passing during the pause, exactly as it does in the room —
    // but the bar must not be able to see it any more.
    msUntilReturn = 1_000;
    fireFrame();

    expect(fillPercent()).toBe(70);
    expect(host.querySelector('.timerbar')?.getAttribute('data-paused')).toBe('true');
  });

  it('does not schedule any animation frame while paused', () => {
    draw(false);
    fireFrame();
    rafCallbacks = [];

    draw(true);

    expect(rafCallbacks).toHaveLength(0);
  });

  it('resumes reading the clock once unpaused', () => {
    draw(false);
    draw(true);
    msUntilReturn = 4_000;

    draw(false);
    fireFrame();

    expect(fillPercent()).toBe(40);
  });
});
