// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerSnapshot, PublicPlayer } from '../../shared/protocol.js';
import { DARK_THEME, DEFAULT_THEME, LIGHT_THEME, SEPIA_THEME } from '../../shared/theme.js';
import type { ThemeTokens } from '../../shared/theme.js';
import { PhoneLobby } from './PhoneLobby.js';
import type { ThemeControl } from './theme.js';

const YOU: PublicPlayer = { id: 'p-1', name: 'Miriam', teamId: null, connected: true };
const OTHERS: PublicPlayer[] = [
  { id: 'p-2', name: 'Jonah', teamId: null, connected: true },
  { id: 'p-3', name: 'Ruth', teamId: null, connected: false },
];

function snapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'QK7P',
    phase: 'lobby',
    paused: false,
    round: -1,
    totalRounds: 10,
    settings: {
      gameId: 'case',
      setId: null,
      translation: 'KJV',
      teamsEnabled: false,
      rounds: 10,
      answerWindowMs: 20_000,
      teamCount: 2,
      openEnded: false,
      autoAdvanceMs: null,
      scoresAfterEachAnswer: true,
      showIndividualScores: false,
      solo: false,
      groupVote: false,
      familiarity: 'broad',
      gameOptions: {},
      theme: DEFAULT_THEME,
    },
    players: [YOU, ...OTHERS],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: 1_000,
    you: YOU,
    yourScore: 0,
    youAnswered: false,
    yourAnswer: null,
    canChangeAnswer: false,
    yourRank: null,
    view: null,
    buzz: null,
    youAreSpent: false,
    yourControlRequest: null,
    ...overrides,
  };
}

let host: HTMLDivElement;
let overrides: (ThemeTokens | null)[];

function themeControl(theme = LIGHT_THEME, isOverridden = false): ThemeControl {
  return {
    theme,
    isOverridden,
    setOverride: (next) => overrides.push(next),
  };
}

function draw(control: ThemeControl, onLeave: () => void = () => undefined): void {
  act(() => {
    render(
      <PhoneLobby
        snapshot={snapshot()}
        onPickTeam={() => undefined}
        onLeave={onLeave}
        themeControl={control}
        joinUrl="https://example.org/play?room=QK7P"
        onRequestControl={() => undefined}
        onWithdrawControlRequest={() => undefined}
        onStart={() => undefined}
      />,
      host
    );
  });
}

function button(label: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll('button')].find((candidate) => candidate.getAttribute('aria-label') === label) ??
    [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(label)) ??
    null
  );
}

/** Opens the "..." menu if it is closed, then returns the item with that label. */
function menuItem(label: string): HTMLButtonElement | null {
  if (!host.querySelector('[role="menu"]')) click(host.querySelector('button[aria-haspopup="menu"]'));
  return [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent?.includes(label)) ?? null;
}

function click(target: HTMLButtonElement | null): void {
  act(() => {
    target?.click();
  });
}

describe('the phone lobby header', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    overrides = [];
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  it('shows the room code with a leading #, and a users icon with the count rather than "N joined"', () => {
    draw(themeControl());
    expect(host.querySelector('.chrome-code')?.textContent).toBe('#QK7P');
    expect(host.textContent).not.toContain('joined');
    expect(host.querySelector('.lobby-count')?.textContent).toContain('3');
  });

  it('labels the room code and the player count, and has an h1', () => {
    draw(themeControl());
    expect(host.querySelector('.chrome-code')?.getAttribute('aria-label')).toContain('Game code');
    expect(host.querySelector('.lobby-count .sr-only')?.textContent).toBe('Players: 3');
    expect(host.querySelector('h1')).not.toBeNull();
  });

  it('offers no inline theme editor any more — theme, settings and leave sit behind the more button', () => {
    draw(themeControl());
    expect(host.querySelector('.theme-editor')).toBeNull();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(menuItem('Theme')).not.toBeNull();
    expect(menuItem('Settings')).not.toBeNull();
    expect(menuItem('Leave')).not.toBeNull();
  });

  it('cycles the theme through the built-in presets on tap, wrapping back to light', () => {
    draw(themeControl(LIGHT_THEME));
    click(menuItem('Theme'));
    expect(overrides).toEqual([DARK_THEME]);
  });

  it('cycles from dark to sepia, and from sepia back to light', () => {
    draw(themeControl(DARK_THEME));
    click(menuItem('Theme'));
    expect(overrides).toEqual([SEPIA_THEME]);

    draw(themeControl(SEPIA_THEME));
    click(menuItem('Theme'));
    expect(overrides).toEqual([SEPIA_THEME, LIGHT_THEME]);
  });
});

describe('the settings panel', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    overrides = [];
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  it('is closed until the settings icon is tapped', () => {
    draw(themeControl());
    expect(host.querySelector('.overlay')).toBeNull();
  });

  it('opens on the settings icon, with the QR code, the room code, and a theme picker', () => {
    draw(themeControl());
    click(menuItem('Settings'));
    expect(host.querySelector('.overlay')).not.toBeNull();
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('QR code to join game QK7P');
    expect(host.querySelector('.settings-code')?.textContent).toBe('#QK7P');
    expect(host.querySelector('.theme-editor')).not.toBeNull();
  });

  it('offers no way to customize individual colours here either', () => {
    draw(themeControl());
    click(menuItem('Settings'));
    expect(host.querySelector('input[type="color"]')).toBeNull();
  });

  it('closes on its own Close button', () => {
    draw(themeControl());
    click(menuItem('Settings'));
    click(button('Close'));
    expect(host.querySelector('.overlay')).toBeNull();
  });

  it('offers a way back to the room’s own theme only once overridden', () => {
    draw(themeControl(LIGHT_THEME, false));
    click(menuItem('Settings'));
    expect(host.textContent).not.toContain("Use the game's theme");

    draw(themeControl(DARK_THEME, true));
    click(menuItem('Settings'));
    expect(host.textContent).toContain("Use the game's theme");
  });
});

describe('leaving the room', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    overrides = [];
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  it('asks before leaving, rather than leaving on the first tap', () => {
    let left = false;
    draw(themeControl(), () => {
      left = true;
    });
    click(menuItem('Leave'));
    expect(left).toBe(false);
    expect(host.textContent).toContain('Leave the game?');
  });

  it('leaves once confirmed', () => {
    let left = false;
    draw(themeControl(), () => {
      left = true;
    });
    click(menuItem('Leave'));
    click(button('Leave the game'));
    expect(left).toBe(true);
  });

  it('stays, and closes the confirmation, when told to', () => {
    let left = false;
    draw(themeControl(), () => {
      left = true;
    });
    click(menuItem('Leave'));
    click(button('Stay'));
    expect(left).toBe(false);
    expect(host.textContent).not.toContain('Leave the game?');
  });
});

describe('running the room from the phone lobby', () => {
  let requested: number;
  let withdrawn: number;
  let started: number;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    requested = 0;
    withdrawn = 0;
    started = 0;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  function drawWith(overrides: Partial<PlayerSnapshot>): void {
    act(() => {
      render(
        <PhoneLobby
          snapshot={snapshot(overrides)}
          onPickTeam={() => undefined}
          onLeave={() => undefined}
          themeControl={themeControl()}
          joinUrl="https://example.org/play?room=QK7P"
          onRequestControl={() => {
            requested += 1;
          }}
          onWithdrawControlRequest={() => {
            withdrawn += 1;
          }}
          onStart={() => {
            started += 1;
          }}
        />,
        host
      );
    });
  }

  function textButton(label: string): HTMLButtonElement | null {
    return [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label) ?? null;
  }

  it('offers Run the game by default, and sends requestControl once', () => {
    drawWith({});
    const runButton = textButton('Ask to be the organizer');
    expect(runButton).not.toBeNull();
    act(() => runButton?.click());
    act(() => runButton?.click());
    expect(requested).toBe(1);
    // Disabled the instant it is pressed, before this snapshot changes.
    expect(runButton?.disabled).toBe(true);
  });

  it('shows a pending request, and lets it be withdrawn', () => {
    drawWith({ yourControlRequest: 'pending' });
    expect(host.textContent).toContain('Waiting for the organizer to say yes');
    expect(textButton('Ask to be the organizer')).toBeNull();
    act(() => textButton('Never mind')?.click());
    expect(withdrawn).toBe(1);
  });

  it('offers to ask again after a denial', () => {
    drawWith({ yourControlRequest: 'denied' });
    expect(host.textContent).toContain('Not this time');
    expect(textButton('Ask to be the organizer')).not.toBeNull();
  });

  it('offers Start once this phone holds control, disabled until someone has joined', () => {
    const control = {
      pendingJudge: null,
      requests: [],
      answeredCount: 0,
      standings: [],
      teamStandings: [],
      overallStandings: [],
      spent: [],
      answer: null,
    };
    drawWith({ control, players: [] });
    expect(textButton('Start game')?.disabled).toBe(true);
    expect(textButton('Ask to be the organizer')).toBeNull();

    act(() => {
      render(null, host);
    });
    drawWith({ control });
    expect(textButton('Start game')?.disabled).toBe(false);
    act(() => textButton('Start game')?.click());
    expect(started).toBe(1);
  });
});
