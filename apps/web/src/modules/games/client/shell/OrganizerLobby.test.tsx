// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog, HostCommand, PublicPlayer, RemoteSnapshot, RoomSettings } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { OrganizerLobby } from './OrganizerLobby.js';

function lobby(
  settings: Partial<RoomSettings> = {},
  players: PublicPlayer[] = [],
  withControl = true
): RemoteSnapshot {
  const snapshot: RemoteSnapshot = {
    viewer: 'remote',
    code: 'QK7P2',
    phase: 'lobby',
    paused: false,
    round: -1,
    totalRounds: 10,
    settings: {
      gameId: 'case',
      setId: null,
      translation: 'KJV',
      teamsEnabled: false,
      teamCount: 2,
      openEnded: false,
      rounds: 10,
      answerWindowMs: 20_000,
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
    players,
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
  if (!withControl) delete snapshot.control;
  return snapshot;
}

const catalog: Catalog = {
  games: [
    {
      id: 'case',
      name: 'The case',
      supportsSolo: false,
      groupVote: 'none',
      usesFamiliarity: true,
      usesTranslation: true,
      usesSet: true,
      usesBuzz: false,
    },
  ],
  sets: [],
  translations: ['KJV'],
};

const RUTH: PublicPlayer = { id: 'p1', name: 'Ruth', teamId: 'red', connected: true };
const SAM: PublicPlayer = { id: 'p2', name: 'Sam', teamId: null, connected: true };

let host: HTMLDivElement;
let commands: HostCommand[];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  commands = [];
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

function draw(snapshot: RemoteSnapshot): void {
  act(() => {
    render(
      <OrganizerLobby
        snapshot={snapshot}
        catalog={catalog}
        onCommand={(command) => commands.push(command)}
        onNavigate={() => undefined}
      />,
      host
    );
  });
}

function button(label: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === label) ?? null;
}

function openMenu(name: string): void {
  act(() => host.querySelector<HTMLButtonElement>(`button[aria-label="Options for ${name}"]`)!.click());
}

function menuItem(label: string): HTMLButtonElement {
  return [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === label)!;
}

describe('the organizer’s lobby', () => {
  it('names the game and how many questions, with the code and TV address to read out', () => {
    draw(lobby());
    expect(host.querySelector('.org-lobby-game')?.textContent).toBe('The case · 10 questions');
    expect(host.querySelector('.org-join-info')?.textContent).toContain('Game code QK7P2');
    expect(host.querySelector('.org-join-info')?.textContent).toContain('/games/tv');
  });

  it('has the main button say how many are playing, and start the game', () => {
    draw(lobby({}, [RUTH, SAM]));
    act(() => button('Start with 2 players')?.click());
    expect(commands).toEqual([{ cmd: 'start' }]);
  });

  it('will not start with nobody in the room', () => {
    draw(lobby());
    expect(button('Start')?.disabled).toBe(true);
  });

  it('offers shuffling only while teams are on', () => {
    draw(lobby({}, [RUTH, SAM]));
    expect(button('Shuffle into teams')).toBeNull();
    act(() => {
      render(null, host);
    });
    draw(lobby({ teamsEnabled: true }, [RUTH, SAM]));
    act(() => button('Shuffle into teams')?.click());
    expect(commands).toEqual([{ cmd: 'shuffleTeams' }]);
  });
});

describe('the roster menu', () => {
  it('moves a player to another team in play, leaving out the team they are on', () => {
    draw(lobby({ teamsEnabled: true, teamCount: 3 }, [RUTH, SAM]));
    openMenu('Ruth');
    const items = [...host.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent);
    expect(items).toEqual(['Move to Blue', 'Move to Green', 'Rename', 'Remove']);
    act(() => menuItem('Move to Blue').click());
    expect(commands).toEqual([{ cmd: 'moveToTeam', playerId: 'p1', teamId: 'blue' }]);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it('offers no team moves with teams off', () => {
    draw(lobby({}, [RUTH]));
    openMenu('Ruth');
    expect([...host.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)).toEqual(['Rename', 'Remove']);
  });

  it('renames a player with a tidied name', () => {
    draw(lobby({}, [RUTH]));
    openMenu('Ruth');
    act(() => menuItem('Rename').click());
    const input = host.querySelector<HTMLInputElement>('input[name="player-name"]')!;
    expect(input.value).toBe('Ruth');
    act(() => {
      input.value = '  Ruth   Ann ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      host.querySelector('.org-rename')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(commands).toEqual([{ cmd: 'rename', playerId: 'p1', name: 'Ruth Ann' }]);
    expect(host.querySelector('input[name="player-name"]')).toBeNull();
  });

  it('removes a player only after a confirm', () => {
    draw(lobby({}, [RUTH, SAM]));
    openMenu('Sam');
    act(() => menuItem('Remove').click());
    expect(commands).toEqual([]);
    act(() => button('Keep')?.click());
    expect(commands).toEqual([]);

    openMenu('Sam');
    act(() => menuItem('Remove').click());
    act(() => button('Remove')?.click());
    expect(commands).toEqual([{ cmd: 'kick', playerId: 'p2' }]);
  });
});

describe('changing the game’s options', () => {
  it('opens the options for the same game, prefilled, and applies them to the open room', () => {
    draw(lobby({ rounds: 15 }, [RUTH]));
    act(() => button('Change')?.click());
    expect(host.querySelector('h1')?.textContent).toBe('The case');
    expect(host.querySelector('.org-seg[aria-label="Length"] [aria-pressed="true"]')?.textContent).toBe('Long (15)');
    act(() => {
      host.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ cmd: 'setSettings', settings: { gameId: 'case', rounds: 15 } });
    expect(host.querySelector('.org-lobby-game')).not.toBeNull();
  });

  it('goes back to the lobby on cancel without sending anything', () => {
    draw(lobby());
    act(() => button('Change')?.click());
    act(() => button('Cancel')?.click());
    expect(commands).toEqual([]);
    expect(host.querySelector('.org-lobby-game')).not.toBeNull();
  });

  it('hides Change and the controls’ effect when another player holds control', () => {
    draw(lobby({}, [RUTH], false));
    expect(button('Change')).toBeNull();
    expect(host.textContent).toContain('Another player is running this game.');
    expect(button('Start with 1 players')?.disabled).toBe(true);
  });
});
