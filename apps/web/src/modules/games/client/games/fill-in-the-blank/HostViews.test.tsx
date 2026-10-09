// @vitest-environment jsdom
import { render } from 'preact';
import type { ComponentType } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PhaseName, RevealPayload, ScreenSnapshot } from '../../../shared/protocol.js';
import { DEFAULT_THEME } from '../../../shared/theme.js';
import type { HostViewProps } from '../../shell/gameViews.js';
import { measuredClock } from '../../shell/clockPort.js';
import { hostViews } from './HostViews.js';
import type { BlankPrompt, BlankReveal } from './payload.js';

const BLANK = '_____';

const PROMPT: BlankPrompt = {
  reference: 'John 3:16',
  text: `For God so loved the ${BLANK}, that he gave his only begotten Son.`,
  blank: BLANK,
};

const DETAIL: BlankReveal = {
  reference: 'John 3:16',
  word: 'world',
  before: 'For God so loved the ',
  after: ', that he gave his only begotten Son.',
};

function snapshot(phase: PhaseName): ScreenSnapshot {
  return {
    viewer: 'screen',
    code: 'QK7P',
    phase,
    paused: false,
    round: 2,
    totalRounds: 10,
    settings: {
      gameId: 'fill-in-the-blank',
      setId: null,
      translation: 'KJV',
      teamsEnabled: false,
      rounds: 10,
      answerWindowMs: 20_000,
      showIndividualScores: false,
      solo: false,
      groupVote: false,
      familiarity: 'broad',
      gameOptions: {},
      theme: DEFAULT_THEME,
    },
    players: [],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: 1_700_000_000_000,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    answeredCount: 0,
    view: PROMPT,
    buzz: null,
  };
}

function revealPayload(overrides: Partial<RevealPayload> = {}): RevealPayload {
  return {
    round: 2,
    correctLabel: 'world',
    aggregates: [
      { label: 'world', count: 4 },
      { label: 'nations', count: 2 },
    ],
    detail: DETAIL,
    ...overrides,
  };
}

let screen: HTMLDivElement;

function draw(
  View: ComponentType<HostViewProps>,
  props: Partial<HostViewProps> = {}
): void {
  act(() => {
    render(
      <View
        snapshot={snapshot('answering')}
        view={PROMPT}
        reveal={null}
        clock={measuredClock}
        send={() => undefined}
        {...props}
      />,
      screen
    );
  });
}

beforeEach(() => {
  screen = document.createElement('div');
  document.body.appendChild(screen);
});

afterEach(() => {
  act(() => {
    render(null, screen);
  });
  screen.remove();
});

describe('the projector while the round is live', () => {
  it('shows the verse with a hole in it', () => {
    draw(hostViews.question);

    expect(screen.textContent).toContain('For God so loved the');
    expect(screen.querySelector('.fitb-blank')?.textContent).toBe(BLANK);
  });

  it('shows the reference from the start of the round, a deliberate reversal of the earlier design', () => {
    draw(hostViews.question);
    const question = screen.textContent ?? '';
    draw(hostViews.answering);
    const answering = screen.textContent ?? '';

    expect(question).toContain('John 3:16');
    expect(answering).toContain('John 3:16');
    expect(screen.querySelector('.fitb-ref')).not.toBeNull();
  });

  it('sends the room to their phones', () => {
    draw(hostViews.answering);

    expect(screen.textContent).toContain('Type the missing word on your phone');
  });

  it('says so when the server has no verse to give', () => {
    draw(hostViews.question, { view: { text: '', blank: BLANK } });

    expect(screen.querySelector('.fitb-missing')).not.toBeNull();
  });

  it('draws nothing rather than guessing at a payload it does not know', () => {
    draw(hostViews.answering, { view: { unexpected: true } });

    expect(screen.querySelector('.fitb-verse')).toBeNull();
    expect(screen.querySelector('.fitb-missing')).not.toBeNull();
  });
});

describe('the projector at the reveal', () => {
  it('shows the word, the verse and where it came from', () => {
    draw(hostViews.reveal, { reveal: revealPayload() });

    expect(screen.querySelector('.fitb-word')?.textContent).toBe('world');
    expect(screen.querySelector('.fitb-ref')?.textContent).toBe('John 3:16');
    expect(screen.querySelector('.fitb-verse')?.textContent).toBe(
      'For God so loved the world, that he gave his only begotten Son.'
    );
    expect(screen.querySelector('.fitb-answer')?.textContent).toBe('world');
  });

  it('tallies what the room typed without naming anybody', () => {
    draw(hostViews.reveal, { reveal: revealPayload() });
    const rows = [...screen.querySelectorAll('.fitb-tally li')];

    expect(rows.map((row) => row.textContent)).toEqual(['world4', 'nations2']);
    expect(rows[0]?.getAttribute('data-correct')).toBe('true');
    expect(rows[1]?.getAttribute('data-correct')).toBe('false');
  });

  it('still shows the word when the detail is a shape it does not know', () => {
    draw(hostViews.reveal, { reveal: revealPayload({ detail: { shrug: true } }) });

    expect(screen.querySelector('.fitb-word')?.textContent).toBe('world');
    expect(screen.querySelector('.fitb-ref')).toBeNull();
  });

  it('says so when there is nothing to reveal', () => {
    draw(hostViews.reveal, { reveal: null });

    expect(screen.querySelector('.fitb-missing')).not.toBeNull();
  });
});
