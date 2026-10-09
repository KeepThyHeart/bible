// @vitest-environment jsdom
/**
 * What the two screens actually put in front of people.
 *
 * The assertions worth having are not about markup. They are that the verse
 * stays off every screen until the reveal, that a tap sends exactly one buzz
 * and the reader's phone exactly one "found it", that the host can only rule
 * once the reader has reported in, and that nobody the host moved on from or
 * never reached is ever named on the big screen.
 */

import { render } from 'preact';
import type { ComponentType } from 'preact';
import { act } from 'preact/test-utils';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BuzzEntry,
  BuzzState,
  ControlPanel,
  HostCommand,
  Intent,
  PersonalResult,
  PlayerSnapshot,
  PublicPlayer,
  RevealPayload,
  RoomSettings,
  ScreenSnapshot,
} from '../../../shared/protocol.js';
import { DEFAULT_THEME } from '../../../shared/theme.js';
import type { ClockPort } from '../../shell/clockPort.js';
import type { HostViewProps, PlayerViewProps } from '../../shell/gameViews.js';
import {
  clearGameViews,
  getGameViews,
  hostViewFor,
  playerViewFor,
} from '../../shell/gameViews.js';
import { GAME_ID, swordDrillViews } from './index.js';

const NOW = 1_700_000_000_000;

// Most of this file exercises `buttons` mode explicitly — the original
// "everyone races to tap Found it" mechanic, still fully supported — so the
// room's actual default (`hostCalls`, nothing set) does not silently change
// what these tests mean. `hostCalls` gets its own describe blocks below.
const SETTINGS: RoomSettings = {
  gameId: GAME_ID,
  setId: null,
  translation: 'KJV',
  teamsEnabled: false,
  rounds: 8,
  answerWindowMs: 20_000,
  showIndividualScores: false,
  solo: false,
  groupVote: false,
  familiarity: 'broad',
  gameOptions: { buzzMode: 'buttons' },
  theme: DEFAULT_THEME,
};

const HOST_CALLS_SETTINGS: RoomSettings = { ...SETTINGS, gameOptions: {} };

const DRILL = { reference: 'Romans 8:28', translation: 'KJV' };

const VERSE = 'And we know that all things work together for good to them that love God.';

const PLAYERS: PublicPlayer[] = [
  { id: 'p-1', name: 'Miriam', teamId: null, connected: true },
  { id: 'p-2', name: 'Jonah', teamId: null, connected: true },
  { id: 'p-3', name: 'Ruth', teamId: null, connected: true },
];

const REVEAL: RevealPayload = {
  round: 2,
  correctLabel: 'Romans 8:28',
  aggregates: [{ label: 'Confirmed', count: 1 }],
  detail: { reference: 'Romans 8:28', text: VERSE, translation: 'KJV', confirmed: ['p-2'] },
};

const stoppedClock: ClockPort = {
  serverNow: () => NOW + 4_321,
  msUntil: () => 0,
  showAt: (_at, task) => {
    task();
    return () => undefined;
  },
  report: () => null,
  onChange: () => () => undefined,
};

function entry(playerId: string): BuzzEntry {
  return { playerId, correctedAt: NOW, arrivedAt: NOW, charsSeen: 0, clamped: false };
}

function buzz(queue: string[], spent: string[] = []): BuzzState {
  return {
    queue: queue.map(entry),
    frozenAtChars: null,
    answerDeadline: null,
    spent,
    secondChanceFor: null,
  };
}

function judging(playerId: string): ControlPanel['pendingJudge'] {
  return {
    playerId,
    question: '',
    canonicalAnswer: '',
    accept: [],
    contextNote: null,
    seenPrefix: '',
    playerAnswer: '',
    suggestion: null,
  };
}

/** The screen's control block, carrying only the judge card these tests exercise. */
function control(
  pendingJudge: ControlPanel['pendingJudge'] = null,
  spent: ControlPanel['spent'] = []
): ControlPanel {
  return {
    pendingJudge,
    requests: [],
    answeredCount: 0,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    spent,
  };
}

function hostSnapshot(overrides: Partial<ScreenSnapshot> = {}): ScreenSnapshot {
  return {
    viewer: 'screen',
    code: 'QK7P',
    phase: 'question',
    paused: false,
    round: 2,
    totalRounds: 8,
    settings: SETTINGS,
    players: PLAYERS,
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: NOW,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    answeredCount: 0,
    view: DRILL,
    buzz: buzz([]),
    control: control(),
    ...overrides,
  };
}

function playerSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'QK7P',
    phase: 'question',
    paused: false,
    round: 2,
    totalRounds: 8,
    settings: SETTINGS,
    players: PLAYERS,
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: NOW,
    you: PLAYERS[0] as PublicPlayer,
    yourScore: 0,
    youAnswered: false,
    yourAnswer: null,
    canChangeAnswer: false,
    yourRank: null,
    view: DRILL,
    buzz: buzz([]),
    youAreSpent: false,
    yourControlRequest: null,
    ...overrides,
  };
}

let screen: HTMLDivElement;
let sent: Intent[];
let commands: HostCommand[];
/** One function for the whole test, as the shell's is, so an effect keyed on it stays put. */
let sendIntent: (intent: Intent) => void;

beforeEach(() => {
  screen = document.createElement('div');
  document.body.appendChild(screen);
  sent = [];
  commands = [];
  sendIntent = (intent) => sent.push(intent);
});

afterEach(() => {
  act(() => {
    render(null, screen);
  });
  screen.remove();
  vi.useRealTimers();
});

function drawHost(
  View: ComponentType<HostViewProps>,
  snapshot: ScreenSnapshot,
  reveal: RevealPayload | null = null
): void {
  act(() => {
    render(
      <View
        snapshot={snapshot}
        view={snapshot.view}
        reveal={reveal}
        clock={stoppedClock}
        send={(command) => commands.push(command)}
      />,
      screen
    );
  });
}

function drawPhone(
  View: ComponentType<PlayerViewProps>,
  snapshot: PlayerSnapshot,
  reveal: RevealPayload | null = null,
  yourResult: PersonalResult | null = null
): void {
  act(() => {
    render(
      <View
        snapshot={snapshot}
        view={snapshot.view}
        reveal={reveal}
        yourResult={yourResult}
        clock={stoppedClock}
        send={sendIntent}
      />,
      screen
    );
  });
}

function button(label: string): HTMLButtonElement | null {
  const found = [...screen.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label)
  );
  return found ?? null;
}

function click(target: HTMLButtonElement | null): void {
  act(() => {
    target?.click();
  });
}

const search = swordDrillViews.player.question;

describe('the phone during the search', () => {
  it('shows the reference and one button, and not the verse', () => {
    drawPhone(search, playerSnapshot());

    expect(screen.textContent).toContain('Romans 8:28');
    expect(screen.textContent).not.toContain('all things work together');
    expect(screen.querySelectorAll('button')).toHaveLength(1);
    expect(button('Found it')).not.toBeNull();
  });

  it("sends one buzz for this round, stamped by the phone's own clock, with nothing read", () => {
    // The shell posts the measured offset beside the buzz, so the stamp must be
    // the uncorrected device clock rather than the port's server estimate.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW + 1_234);
    drawPhone(search, playerSnapshot());
    click(button('Found it'));

    expect(sent).toEqual([{ kind: 'buzz', round: 2, charsSeen: 0, tClient: NOW + 1_234 }]);
  });

  it('says the tap landed at once, and offers no second one', () => {
    drawPhone(search, playerSnapshot());
    click(button('Found it'));

    expect(button('Found it')).toBeNull();
    expect(screen.textContent).toContain('you’re in line');
    expect(sent).toHaveLength(1);
  });

  it('does not take a tap while the room is paused', () => {
    drawPhone(search, playerSnapshot({ paused: true }));
    click(button('Found it'));

    expect(sent).toEqual([]);
  });

  it('starts the next reference with the button back', () => {
    drawPhone(search, playerSnapshot());
    click(button('Found it'));
    drawPhone(search, playerSnapshot({ round: 3 }));

    expect(button('Found it')).not.toBeNull();
  });

  it('tells a phone further back how many are ahead of it', () => {
    drawPhone(search, playerSnapshot({ phase: 'answering', buzz: buzz(['p-2', 'p-3', 'p-1']) }));

    expect(screen.textContent).toContain('2 ahead of you');
    expect(sent).toEqual([]);
  });

  it("says 'found it' for the reader, once, so the clock stops while the host listens", () => {
    const reading = playerSnapshot({ phase: 'answering', buzz: buzz(['p-1', 'p-2']) });
    drawPhone(search, reading);
    // Another snapshot arrives — somebody else joined the queue — before the
    // room has recorded this phone's answer.
    drawPhone(search, { ...reading, buzz: buzz(['p-1', 'p-2', 'p-3']) });

    expect(sent).toEqual([{ kind: 'answer', round: 2, value: { type: 'found' } }]);
    expect(screen.textContent).toContain('Read it aloud now');
  });

  it('says nothing more once the room has the reader’s answer', () => {
    drawPhone(
      search,
      playerSnapshot({ phase: 'answering', buzz: buzz(['p-1']), youAnswered: true })
    );

    expect(sent).toEqual([]);
  });

  it('waits out a pause before saying it', () => {
    drawPhone(search, playerSnapshot({ phase: 'answering', buzz: buzz(['p-1']), paused: true }));

    expect(sent).toEqual([]);
  });

  it('tells a phone the host moved on from, and nobody else', () => {
    // `spent` no longer travels on `buzz` itself (see `PublicBuzzState`'s own
    // doc comment) — this phone learns its own status from `youAreSpent`.
    drawPhone(
      search,
      playerSnapshot({ phase: 'answering', buzz: buzz(['p-2']), youAreSpent: true })
    );

    expect(screen.textContent).toContain('Not that one this time');
    expect(button('Found it')).toBeNull();
  });

  it('draws a line of text for a round with nothing to find', () => {
    drawPhone(search, playerSnapshot({ view: null }));

    expect(screen.textContent).toContain('Getting the question ready');
    expect(screen.querySelector('button')).toBeNull();
  });
});

describe('the phone during the search, in the room’s default (host-calls) mode', () => {
  it('has no button at all — raising a hand is not something a tap sends', () => {
    drawPhone(search, playerSnapshot({ settings: HOST_CALLS_SETTINGS }));

    expect(screen.textContent).toContain('Romans 8:28');
    expect(screen.querySelector('button')).toBeNull();
    expect(screen.textContent).toContain('Raise your hand');
  });

  it('still tells the reader to read once the host calls them onto the buzzer', () => {
    // The host's `callOn` lands this phone at the head of the queue exactly
    // as its own tap would in `buttons` mode — the auto-"found it" effect
    // does not know or care which mode put it there.
    drawPhone(
      search,
      playerSnapshot({
        phase: 'answering',
        settings: HOST_CALLS_SETTINGS,
        buzz: buzz(['p-1']),
      })
    );

    expect(sent).toEqual([{ kind: 'answer', round: 2, value: { type: 'found' } }]);
    expect(screen.textContent).toContain('Read it aloud now');
  });

  it('tells a phone waiting behind the reader how many are ahead, same as buttons mode', () => {
    drawPhone(
      search,
      playerSnapshot({
        phase: 'answering',
        settings: HOST_CALLS_SETTINGS,
        buzz: buzz(['p-2', 'p-3', 'p-1']),
      })
    );

    expect(screen.textContent).toContain('2 ahead of you');
    expect(screen.querySelector('button')).toBeNull();
  });
});

describe('the big screen during the search', () => {
  it('shows the reference, how many have tapped, and not the verse, when the payload carries none', () => {
    drawHost(
      swordDrillViews.host.question,
      hostSnapshot({ buzz: buzz([]), control: control(null, ['p-3']) })
    );

    expect(screen.textContent).toContain('Romans 8:28');
    expect(screen.textContent).toContain('1 tapped Found it');
    expect(screen.textContent).not.toContain('all things work together');
    expect(screen.textContent).not.toContain('Ruth');
  });

  it('shows the verse text too, once the host payload carries it, so a citation can be confirmed at once', () => {
    drawHost(
      swordDrillViews.host.question,
      hostSnapshot({ view: { ...DRILL, text: VERSE }, buzz: buzz([], ['p-3']) })
    );

    expect(screen.textContent).toContain('Romans 8:28');
    expect(screen.textContent).toContain('all things work together');
  });

  it('draws a line of text for a round with nothing to find', () => {
    drawHost(swordDrillViews.host.question, hostSnapshot({ view: null }));

    expect(screen.textContent).toContain('Nothing to find this round.');
  });

  it('reassures the host that confirming a reader cost the search nothing, once one has been confirmed', () => {
    const confirmedOnce: BuzzState & { confirmed: string[] } = { ...buzz([]), confirmed: ['p-2'] };
    drawHost(swordDrillViews.host.question, hostSnapshot({ buzz: confirmedOnce }));

    expect(screen.textContent).toContain('no search time is lost');
  });

  it('says nothing about the clock before anyone has been confirmed', () => {
    drawHost(swordDrillViews.host.question, hostSnapshot({ buzz: buzz([]) }));

    expect(screen.textContent).not.toContain('search time');
  });
});

describe('the big screen during the search, in the room’s default (host-calls) mode', () => {
  it('offers every connected player as a button, and calls one on when tapped', () => {
    drawHost(
      swordDrillViews.host.question,
      hostSnapshot({ settings: HOST_CALLS_SETTINGS, buzz: buzz([]) })
    );

    expect(screen.textContent).toContain('Who found it?');
    const jonah = button('Jonah');
    expect(jonah).not.toBeNull();
    click(jonah);

    expect(commands).toEqual([{ cmd: 'callOn', playerId: 'p-2' }]);
  });

  it('leaves out a player already reading, waiting, spent or confirmed', () => {
    const busy: BuzzState & { confirmed: string[] } = { ...buzz(['p-1', 'p-2']), confirmed: [] };
    drawHost(
      swordDrillViews.host.question,
      hostSnapshot({ settings: HOST_CALLS_SETTINGS, buzz: busy, control: control(null, ['p-3']) })
    );

    expect(button('Miriam')).toBeNull();
    expect(button('Jonah')).toBeNull();
    expect(button('Ruth')).toBeNull();
  });

  it('leaves out a player who has disconnected', () => {
    const offline = PLAYERS.map((player) => (player.id === 'p-2' ? { ...player, connected: false } : player));
    drawHost(
      swordDrillViews.host.question,
      hostSnapshot({ settings: HOST_CALLS_SETTINGS, players: offline, buzz: buzz([]) })
    );

    expect(button('Jonah')).toBeNull();
  });

  it('says nothing about a call-on panel in the room’s buttons mode', () => {
    drawHost(swordDrillViews.host.question, hostSnapshot({ buzz: buzz([]) }));

    expect(screen.textContent).not.toContain('Who found it?');
  });
});

describe('the big screen while someone reads', () => {
  const answering = swordDrillViews.host.answering;

  it('names the reader and how many are waiting, and nobody who has been passed on', () => {
    drawHost(
      answering,
      hostSnapshot({ phase: 'answering', buzz: buzz(['p-1', 'p-2'], ['p-3']) })
    );

    expect(screen.textContent).toContain('Miriam');
    expect(screen.textContent).toContain('1 more in line');
    expect(screen.textContent).not.toContain('Ruth');
    // Who is queued behind the reader is their own business until it is their turn.
    expect(screen.textContent).not.toContain('Jonah');
  });

  it("holds the ruling until the reader's phone has reported in", () => {
    drawHost(answering, hostSnapshot({ phase: 'answering', buzz: buzz(['p-1']) }));
    click(button('Confirm'));

    expect(button('Confirm')?.disabled).toBe(true);
    expect(button('Next in line')?.disabled).toBe(true);
    expect(screen.textContent).toContain('Waiting for Miriam’s phone');
    expect(commands).toEqual([]);
  });

  it('does not take a ruling meant for an earlier reader as one for this reader', () => {
    drawHost(
      answering,
      hostSnapshot({ phase: 'answering', buzz: buzz(['p-2']), control: control(judging('p-1')) })
    );

    expect(button('Confirm')?.disabled).toBe(true);
  });

  it('confirms the reader', () => {
    drawHost(
      answering,
      hostSnapshot({ phase: 'answering', buzz: buzz(['p-1']), control: control(judging('p-1')) })
    );
    click(button('Confirm'));

    expect(commands).toEqual([{ cmd: 'judge', verdict: 'correct' }]);
  });

  it('passes the turn on', () => {
    drawHost(
      answering,
      hostSnapshot({ phase: 'answering', buzz: buzz(['p-1']), control: control(judging('p-1')) })
    );
    click(button('Next in line'));

    expect(commands).toEqual([{ cmd: 'judge', verdict: 'incorrect' }]);
  });

  it('never puts the verse up before the reveal, even with the host holding it', () => {
    const pending = { ...judging('p-1'), canonicalAnswer: VERSE } as ControlPanel['pendingJudge'];
    drawHost(
      answering,
      hostSnapshot({ phase: 'answering', buzz: buzz(['p-1']), control: control(pending) })
    );

    expect(screen.textContent).not.toContain('all things work together');
  });

  it('lists who has been confirmed so far, once the room records it', () => {
    const extended: BuzzState & { confirmed: string[] } = {
      ...buzz(['p-1'], ['p-2', 'p-3']),
      confirmed: ['p-2'],
    };
    drawHost(answering, hostSnapshot({ phase: 'answering', buzz: extended }));

    expect(screen.textContent).toContain('Confirmed so far');
    expect(screen.textContent).toContain('Jonah');
    expect(screen.textContent).not.toContain('Ruth');
  });

  it('says whose clock the timer is now showing, so a fresh full bar does not read as a restart', () => {
    drawHost(answering, hostSnapshot({ phase: 'answering', buzz: buzz(['p-1']) }));

    expect(screen.textContent).toContain('Miriam’s own time to answer');
    expect(screen.textContent).toContain('the search clock is paused');
  });

  it('still offers the call-on panel for a second reader, in host-calls mode', () => {
    drawHost(
      answering,
      hostSnapshot({ phase: 'answering', settings: HOST_CALLS_SETTINGS, buzz: buzz(['p-1']) })
    );

    const jonah = button('Jonah');
    expect(jonah).not.toBeNull();
    click(jonah);

    expect(commands).toEqual([{ cmd: 'callOn', playerId: 'p-2' }]);
  });
});

describe('the big screen at the reveal', () => {
  const reveal = swordDrillViews.host.reveal;

  it('puts up the verse, the reference and who was heard reading it', () => {
    drawHost(reveal, hostSnapshot({ phase: 'reveal', buzz: buzz(['p-1'], ['p-3']) }), REVEAL);

    expect(screen.querySelector('.sd-answer')?.textContent).toBe('Romans 8:28');
    expect(screen.textContent).toContain(VERSE);
    expect(screen.querySelector('.sd-names')?.textContent).toBe('Jonah');
  });

  it('names nobody the host moved on from or never reached', () => {
    drawHost(
      reveal,
      hostSnapshot({
        phase: 'reveal',
        buzz: buzz(['p-1']),
        control: control(null, ['p-3', 'p-2']),
      }),
      REVEAL
    );

    expect(screen.textContent).not.toContain('Ruth');
    expect(screen.textContent).not.toContain('Miriam');
    expect(screen.textContent).toContain('1 confirmed · 3 tapped Found it');
  });

  it('draws a line of text for a round with nothing behind it', () => {
    drawHost(reveal, hostSnapshot({ phase: 'reveal' }), { ...REVEAL, detail: null });

    expect(screen.textContent).toContain('Nothing to show for this round.');
  });
});

describe('the phone at the reveal', () => {
  const reveal = swordDrillViews.player.reveal;

  it('shows the verse and congratulates a confirmed reader', () => {
    const result: PersonalResult = {
      correct: true,
      pointsAwarded: 100,
      submitted: { type: 'found' },
      note: null,
    };
    drawPhone(reveal, playerSnapshot({ phase: 'reveal', buzz: buzz(['p-1']) }), REVEAL, result);

    expect(screen.textContent).toContain(VERSE);
    expect(screen.textContent).toContain('Confirmed — well found.');
  });

  it('tells someone never reached that they found it, with nothing else attached', () => {
    drawPhone(reveal, playerSnapshot({ phase: 'reveal', buzz: buzz(['p-2', 'p-1']) }), REVEAL);

    expect(screen.textContent).toContain('You found it too.');
    expect(screen.textContent).not.toMatch(/points|\+\d/);
  });

  it('tells a reader the host moved on from, privately', () => {
    const result: PersonalResult = {
      correct: false,
      pointsAwarded: 0,
      submitted: { type: 'found' },
      note: 'Not that one this time.',
    };
    drawPhone(reveal, playerSnapshot({ phase: 'reveal', buzz: buzz([], ['p-1']) }), REVEAL, result);

    expect(screen.textContent).toContain('Not that one this time.');
  });

  it('shows a phone that never tapped where the verse was', () => {
    drawPhone(reveal, playerSnapshot({ phase: 'reveal', buzz: buzz(['p-2']) }), REVEAL);

    expect(screen.textContent).toContain('Here it is, for next time.');
  });
});

describe('putting the game on the client', () => {
  // The registry is process-wide, and one left populated is a puzzle for the
  // next file rather than a failure in this one.
  afterAll(() => {
    clearGameViews();
  });

  it('registers itself as a side effect of being imported', () => {
    expect(getGameViews(GAME_ID)).toBe(swordDrillViews);
    expect(GAME_ID).toBe('sword-drill');
  });

  it('covers all three phases on both screens', () => {
    for (const phase of ['question', 'answering', 'reveal'] as const) {
      expect(hostViewFor(GAME_ID, phase)).toBe(swordDrillViews.host[phase]);
      expect(playerViewFor(GAME_ID, phase)).toBe(swordDrillViews.player[phase]);
    }
  });
});
