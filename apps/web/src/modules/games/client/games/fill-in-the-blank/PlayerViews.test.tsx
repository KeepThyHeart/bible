// @vitest-environment jsdom
import { render } from 'preact';
import type { ComponentType } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  Intent,
  PersonalResult,
  PlayerSnapshot,
  RevealPayload,
} from '../../../shared/protocol.js';
import { DEFAULT_THEME } from '../../../shared/theme.js';
import type { PlayerViewProps } from '../../shell/gameViews.js';
import { measuredClock } from '../../shell/clockPort.js';
import { playerViews } from './PlayerViews.js';
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

function snapshot(youAnswered = false, round = 2): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'QK7P',
    phase: 'answering',
    paused: false,
    round,
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
    you: { id: 'p-1', name: 'Miriam', teamId: null, connected: true },
    yourScore: 100,
    youAnswered,
    yourAnswer: null,
    canChangeAnswer: false,
    yourRank: null,
    view: PROMPT,
    buzz: null,
    youAreSpent: false,
    yourControlRequest: null,
  };
}

function reveal(detail: unknown = DETAIL): RevealPayload {
  return { round: 2, correctLabel: 'world', aggregates: [], detail };
}

function result(overrides: Partial<PersonalResult> = {}): PersonalResult {
  return {
    correct: true,
    pointsAwarded: 100,
    submitted: { type: 'text', text: 'world' },
    note: null,
    ...overrides,
  };
}

let phone: HTMLDivElement;
let sent: Intent[];

function draw(
  View: ComponentType<PlayerViewProps>,
  props: Partial<PlayerViewProps> = {}
): void {
  act(() => {
    render(
      <View
        snapshot={snapshot()}
        view={PROMPT}
        reveal={null}
        yourResult={null}
        clock={measuredClock}
        send={(intent) => sent.push(intent)}
        {...props}
      />,
      phone
    );
  });
}

function type(value: string): void {
  const input = phone.querySelector('input');
  if (input === null) throw new Error('no answer box on the phone');
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function submit(): void {
  const form = phone.querySelector('form');
  if (form === null) throw new Error('no form on the phone');
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  phone = document.createElement('div');
  document.body.appendChild(phone);
  sent = [];
});

afterEach(() => {
  act(() => {
    render(null, phone);
  });
  phone.remove();
});

describe('the box on the phone', () => {
  it('offers somewhere to type and something obvious to press', () => {
    draw(playerViews.answering);

    expect(phone.querySelector('input')).not.toBeNull();
    expect(phone.querySelector('button[type="submit"]')?.textContent).toBe('Send');
  });

  it('repeats the verse when there is no screen to leave it to', () => {
    draw(playerViews.answering, { snapshot: snapshot() });
    expect(phone.textContent).toContain('For God so loved the');
    expect(phone.querySelector('input')).not.toBeNull();
  });

  it('renders the input without repeating the prompt once a screen has it', () => {
    draw(playerViews.answering, { snapshot: { ...snapshot(), questionOnScreen: true } });
    expect(phone.textContent).not.toContain('For God so loved the');
    expect(phone.querySelector('input')).not.toBeNull();
  });

  it('turns off the phone conveniences that would rewrite a King James word', () => {
    draw(playerViews.answering);
    const input = phone.querySelector('input');

    expect(input?.getAttribute('autocorrect')).toBe('off');
    expect(input?.getAttribute('autocomplete')).toBe('off');
    expect(input?.getAttribute('autocapitalize')).toBe('none');
    // Spell checking is turned off too, but through the element's property
    // rather than an attribute, and this DOM implementation does not carry
    // that property to assert against.
  });

  it('sends what was typed, for the round it was typed in', () => {
    draw(playerViews.answering);
    type('world');
    submit();

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'text', text: 'world' } },
    ]);
  });

  it('trims the spaces a thumb leaves behind', () => {
    draw(playerViews.answering);
    type('  world  ');
    submit();

    expect(sent[0]).toEqual({ kind: 'answer', round: 2, value: { type: 'text', text: 'world' } });
  });

  it('will not send an empty box', () => {
    draw(playerViews.answering);
    submit();

    expect(sent).toEqual([]);
    expect(phone.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
  });

  it('takes the box away once the answer is in, when it cannot be changed', () => {
    draw(playerViews.answering, { snapshot: snapshot(true) });

    expect(phone.querySelector('input')).toBeNull();
    expect(phone.textContent).toContain('Answer sent');
  });

  it('keeps the box open once an answer is sent, when it can still be changed', () => {
    draw(playerViews.answering, {
      snapshot: { ...snapshot(true), canChangeAnswer: true, yourAnswer: { type: 'text', text: 'world' } },
    });

    expect(phone.querySelector('input')).not.toBeNull();
    expect(phone.querySelector('input')?.hasAttribute('disabled')).toBe(false);
    expect(phone.textContent).toContain('Sent: world. You can change it until time runs out.');
  });

  it('lets a later answer replace an earlier one when it can still be changed', () => {
    draw(playerViews.answering, { snapshot: { ...snapshot(), canChangeAnswer: true } });
    type('worlde');
    submit();
    type('world');
    submit();

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'text', text: 'worlde' } },
      { kind: 'answer', round: 2, value: { type: 'text', text: 'world' } },
    ]);
  });

  it('empties the box when the next question arrives', () => {
    draw(playerViews.answering);
    type('world');
    draw(playerViews.answering, { snapshot: snapshot(false, 3) });

    expect(phone.querySelector('input')?.value).toBe('');
  });

  it('shows the verse with its reference, from the start of the round', () => {
    draw(playerViews.answering);

    expect(phone.querySelector('.fitb-blank')?.textContent).toBe(BLANK);
    expect(phone.textContent).toContain('John 3:16');
    expect(phone.querySelector('.fitb-ref')).not.toBeNull();
  });
});

describe('the phone during the reading phase', () => {
  it('shows the verse when there is no screen to leave it to', () => {
    draw(playerViews.question, { snapshot: snapshot() });
    expect(phone.textContent).toContain('For God so loved the');
  });

  it('points at the screen instead of repeating the verse once one is present', () => {
    draw(playerViews.question, { snapshot: { ...snapshot(), questionOnScreen: true } });
    expect(phone.textContent).not.toContain('For God so loved the');
    expect(phone.textContent).toContain('Look at the screen.');
  });
});

describe('the phone at the reveal', () => {
  it('shows the word, the verse and the reference', () => {
    draw(playerViews.reveal, { reveal: reveal(), yourResult: result() });

    expect(phone.querySelector('.fitb-word')?.textContent).toBe('world');
    expect(phone.querySelector('.fitb-ref')?.textContent).toBe('John 3:16');
    expect(phone.querySelector('.fitb-verse')?.textContent).toBe(
      'For God so loved the world, that he gave his only begotten Son.'
    );
  });

  it('tells this phone how it did, and nobody else', () => {
    draw(playerViews.reveal, { reveal: reveal(), yourResult: result({ correct: false }) });

    expect(phone.querySelector('.fitb-verdict')?.textContent).toBe('Not this time');
    expect(phone.querySelector('.fitb-verdict')?.getAttribute('data-correct')).toBe('false');
  });

  it('passes on the note a fuzzy match earned', () => {
    draw(playerViews.reveal, {
      reveal: reveal(),
      yourResult: result({ note: 'Close enough!' }),
    });

    expect(phone.querySelector('.fitb-verdict')?.textContent).toBe('Close enough!');
  });

  it('echoes back what was typed', () => {
    draw(playerViews.reveal, {
      reveal: reveal(),
      yourResult: result({ submitted: { type: 'text', text: 'nations' } }),
    });

    expect(phone.textContent).toContain('nations');
  });

  it('says nothing about a result the server withheld', () => {
    draw(playerViews.reveal, { reveal: reveal(), yourResult: null });

    expect(phone.querySelector('.fitb-verdict')).toBeNull();
    expect(phone.querySelector('.fitb-word')?.textContent).toBe('world');
  });

  it('still shows the word when the detail is a shape it does not know', () => {
    draw(playerViews.reveal, { reveal: reveal({ shrug: true }), yourResult: result() });

    expect(phone.querySelector('.fitb-word')?.textContent).toBe('world');
    expect(phone.querySelector('.fitb-ref')).toBeNull();
  });
});
