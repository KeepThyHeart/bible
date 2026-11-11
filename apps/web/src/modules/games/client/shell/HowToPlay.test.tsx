// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClockContext } from './clockPort.js';
import { clearGameViews, registerGameViews } from './gameViews.js';
import type { GameViews } from './gameViews.js';
import { HowToPlay } from './HowToPlay.js';
import { handClock } from './screenFixtures.js';

let host: HTMLDivElement;
const time = { now: 0 };

function draw(props: { endsAt: number | null; paused?: boolean }): void {
  act(() => {
    render(
      <ClockContext.Provider value={handClock(time)}>
        <HowToPlay gameId="fill-in-the-blank" name="Fill in the blank" endsAt={props.endsAt} paused={props.paused ?? false} />
      </ClockContext.Provider>,
      host
    );
  });
}

const nothing = () => null;
const views: GameViews = {
  id: 'fill-in-the-blank',
  host: { question: nothing, answering: nothing, reveal: nothing },
  player: { question: nothing, answering: nothing, reveal: nothing },
  howToPlay: {
    summaryKey: 'games.fillInTheBlank.howToPlay.summary',
    summaryFallback: 'A verse appears with one word missing.',
    steps: [
      { key: 'games.fillInTheBlank.howToPlay.one', fallback: 'Type the word on your phone.' },
      { key: 'games.fillInTheBlank.howToPlay.two', fallback: '100 points for each right answer.' },
    ],
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  time.now = 0;
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
  clearGameViews();
  vi.useRealTimers();
});

describe('how to play', () => {
  it('shows the game name, the summary line and the steps', () => {
    registerGameViews(views);
    draw({ endsAt: 8_000 });
    expect(host.querySelector('.how-to-play-title')?.textContent).toBe('Fill in the blank');
    expect(host.querySelector('.how-to-play-summary')?.textContent).toBe('A verse appears with one word missing.');
    expect([...host.querySelectorAll('.how-to-play-steps li')].map((li) => li.textContent)).toEqual([
      'Type the word on your phone.',
      '100 points for each right answer.',
    ]);
  });

  it('falls back to a plain line with the game name when the game has no rules registered', () => {
    draw({ endsAt: 8_000 });
    expect(host.querySelector('.how-to-play-summary')?.textContent).toBe('Get ready to play Fill in the blank.');
    expect(host.querySelector('.how-to-play-steps')).toBeNull();
  });

  it('counts down from the deadline, rounding up to whole seconds', () => {
    draw({ endsAt: 8_000 });
    expect(host.querySelector('.how-to-play-countdown')?.textContent).toBe('Starting in 8');
    time.now = 2_500;
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(host.querySelector('.how-to-play-countdown')?.textContent).toBe('Starting in 6');
    time.now = 7_900;
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(host.querySelector('.how-to-play-countdown')?.textContent).toBe('Starting in 1');
  });

  it('holds still while paused', () => {
    draw({ endsAt: 8_000, paused: true });
    expect(host.querySelector('.how-to-play-countdown')?.textContent).toBe('Paused');
  });

  it('shows no countdown when the intro waits on the organizer', () => {
    draw({ endsAt: null });
    expect(host.querySelector('.how-to-play-countdown')).toBeNull();
  });
});
