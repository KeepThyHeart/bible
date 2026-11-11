// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog, ScreenSnapshot } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { HostLobby } from './HostLobby.js';

function lobby(settings: Partial<ScreenSnapshot['settings']> = {}): ScreenSnapshot {
  return {
    viewer: 'screen',
    code: 'QK7P',
    phase: 'lobby',
    paused: false,
    round: -1,
    totalRounds: 10,
    settings: {
      gameId: 'case',
      setId: null,
      translation: 'KJV',
      teamsEnabled: true,
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
      ...settings,
    },
    players: [],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: 1_000,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    answeredCount: 0,
    view: null,
    buzz: null,
    // Holding control by default, so the existing settings/start behaviour
    // here is exercised exactly as before this field existed.
    control: {
      pendingJudge: null,
      requests: [],
      answeredCount: 0,
      standings: [],
      teamStandings: [],
      overallStandings: [],
      spent: [],
      answer: null,
    },
  };
}

/** `exactOptionalPropertyTypes` refuses `control: undefined` in an override; this actually omits the key. */
function withoutControl(snapshot: ScreenSnapshot): ScreenSnapshot {
  const rest = { ...snapshot };
  delete rest.control;
  return rest;
}

const CATALOG: Catalog = {
  games: [],
  sets: [],
  translations: ['KJV'],
};

let host: HTMLDivElement;
let reclaimed: number;

function draw(snapshot: ScreenSnapshot, extra: { catalog?: Catalog; catalogLoaded?: boolean; isOwner?: boolean } = {}): void {
  act(() => {
    render(
      <HostLobby
        snapshot={snapshot}
        catalog={extra.catalog ?? CATALOG}
        catalogLoaded={extra.catalogLoaded ?? true}
        gameLabel="Fill in the blank"
        joinUrl="https://example.org/games/play?room=QK7P"
        isOwner={extra.isOwner ?? true}
        onReclaim={() => {
          reclaimed += 1;
        }}
      />,
      host
    );
  });
}

function button(label: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(label)) ?? null;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  reclaimed = 0;
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

describe('the lobby on the shared screen', () => {
  it('shows where to join, the large code, the QR and the game that is next', () => {
    draw(lobby());
    expect(host.querySelector('.join-at')?.textContent).toBe('Join at example.org/games/play');
    expect(host.querySelector('.big-code')?.textContent).toBe('QK7P');
    expect(host.querySelector('.qr')).not.toBeNull();
    expect(host.querySelector('.lobby-next')?.textContent).toBe('Next: Fill in the blank');
  });

  it('carries no settings controls and no way to start', () => {
    draw(lobby());
    expect(host.querySelector('.field')).toBeNull();
    expect(host.querySelector('.settings-grid')).toBeNull();
    expect(host.querySelector('select')).toBeNull();
    expect(host.querySelector('input')).toBeNull();
    expect(button('Start')).toBeNull();
    expect(button('Play too')).toBeNull();
  });

  it('lists the players as chips and counts them', () => {
    const snapshot = lobby();
    snapshot.players = [
      { id: 'p1', name: 'Ruth', teamId: null, connected: true },
      { id: 'p2', name: 'Sam', teamId: null, connected: true },
    ];
    draw(snapshot);
    expect([...host.querySelectorAll('.name-chip .name-text')].map((el) => el.textContent)).toEqual(['Ruth', 'Sam']);
    expect(host.querySelector('.lobby-count')?.textContent).toBe('2 players');
  });

  it('says 1 player for one, and waits when nobody has joined', () => {
    draw(lobby());
    expect(host.textContent).toContain('Waiting for players to join.');
    expect(host.querySelector('.lobby-count')?.textContent).toBe('0 players');
    const one = lobby();
    one.players = [{ id: 'p1', name: 'Ruth', teamId: null, connected: true }];
    draw(one);
    expect(host.querySelector('.lobby-count')?.textContent).toBe('1 player');
  });

  it('colours a chip by team, with the team named as text, only when teams are on', () => {
    const snapshot = lobby({ teamsEnabled: true });
    snapshot.players = [{ id: 'p1', name: 'Ruth', teamId: 'blue', connected: true }];
    draw(snapshot);
    expect(host.querySelector('.name-chip')?.getAttribute('data-team')).toBe('blue');
    expect(host.querySelector('.team-chip')?.textContent).toBe('Blue');

    const off = lobby({ teamsEnabled: false });
    off.players = [{ id: 'p1', name: 'Ruth', teamId: 'blue', connected: true }];
    draw(off);
    expect(host.querySelector('.name-chip')?.getAttribute('data-team')).toBeNull();
    expect(host.querySelector('.team-chip')).toBeNull();
  });

  it('marks a disconnected player with real text, not a CSS pseudo-element', () => {
    const snapshot = lobby();
    snapshot.players = [{ id: 'p1', name: 'Ruth', teamId: null, connected: false }];
    draw(snapshot);
    expect(host.querySelector('.away-marker')?.textContent).toBe('(away)');
    expect(host.querySelector('.name-chip')?.textContent).toContain('(away)');
  });

  it('gives a long name a title attribute rather than letting it wrap the row', () => {
    const longName = 'A Genuinely Very Long Display Name';
    const snapshot = lobby();
    snapshot.players = [{ id: 'p1', name: longName, teamId: null, connected: true }];
    draw(snapshot);
    expect(host.querySelector('.name-text')?.getAttribute('title')).toBe(longName);
  });
});

describe('taking control back', () => {
  const elsewhere = (): ScreenSnapshot => {
    const rest = lobby();
    delete rest.control;
    rest.controller = { kind: 'player', playerId: 'p1' };
    rest.players = [{ id: 'p1', name: 'Ellen', teamId: null, connected: true }];
    return rest;
  };

  it('is offered on the owner screen when another device runs the room', () => {
    draw(elsewhere());
    expect(host.textContent).toContain('Ellen is the organizer.');
    act(() => button('Take back control')?.click());
    expect(reclaimed).toBe(1);
  });

  it('is not offered on a display screen', () => {
    draw(elsewhere(), { isOwner: false });
    expect(button('Take back control')).toBeNull();
  });

  it('is not offered while this screen is the controller', () => {
    draw(lobby());
    expect(button('Take back control')).toBeNull();
  });
});

describe('warning when no Bible module is installed', () => {
  const noTranslations: Catalog = { games: [], sets: [], translations: [] };

  it('says nothing while the catalog is still loading, even with an empty result', () => {
    draw(lobby(), { catalog: noTranslations, catalogLoaded: false });
    expect(host.textContent).not.toContain('No Bible module');
  });

  it('warns once the catalog has answered with no translations', () => {
    draw(lobby(), { catalog: noTranslations });
    expect(host.textContent).toContain('No Bible module is installed');
  });

  it('says nothing once the catalog answers with at least one translation', () => {
    draw(lobby());
    expect(host.textContent).not.toContain('No Bible module');
  });
});
