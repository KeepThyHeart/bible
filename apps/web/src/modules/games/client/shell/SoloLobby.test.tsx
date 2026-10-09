// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog, PlayerSnapshot, RoomSettings } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { SoloLobby } from './SoloLobby.js';

function solo(settings: Partial<RoomSettings> = {}): PlayerSnapshot {
  const merged: RoomSettings = {
    gameId: 'fill-in-the-blank',
    setId: null,
    translation: 'KJV',
    teamsEnabled: false,
    rounds: 10,
    answerWindowMs: 20_000,
    showIndividualScores: false,
    solo: true,
    groupVote: false,
    familiarity: 'broad',
    gameOptions: {},
    theme: DEFAULT_THEME,
    ...settings,
  };
  return {
    viewer: 'player',
    code: 'QK7P',
    phase: 'lobby',
    paused: false,
    round: -1,
    totalRounds: merged.rounds,
    settings: merged,
    players: [{ id: 'p1', name: 'You', teamId: null, connected: true }],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: 1_000,
    you: { id: 'p1', name: 'You', teamId: null, connected: true },
    yourScore: 0,
    youAnswered: false,
    yourAnswer: null,
    canChangeAnswer: false,
    yourRank: null,
    view: null,
    buzz: null,
    youAreSpent: false,
    yourControlRequest: null,
  };
}

function catalogWith(games: Catalog['games']): Catalog {
  return { games, sets: [], translations: ['KJV'] };
}

const soloCatalog = catalogWith([
  {
    id: 'fill-in-the-blank',
    name: 'Fill in the blank',
    supportsSolo: true,
    groupVote: 'none',
    usesFamiliarity: true,
    usesTranslation: true,
    usesSet: true,
  },
  {
    id: 'who-am-i',
    name: 'Who am I',
    scopeLabel: 'People of the Bible',
    supportsSolo: true,
    groupVote: 'none',
    usesFamiliarity: true,
    usesTranslation: false,
    usesSet: false,
  },
  {
    id: 'sword-drill',
    name: 'Sword drill',
    supportsSolo: false,
    groupVote: 'none',
    usesFamiliarity: true,
    usesTranslation: true,
    usesSet: true,
  },
]);

let host: HTMLDivElement;
let asked: Partial<RoomSettings>[];
let started: boolean;

function draw(
  settings: Partial<RoomSettings> = {},
  catalog: Catalog = soloCatalog,
  catalogLoaded = true
): void {
  act(() => {
    render(
      <SoloLobby
        snapshot={solo(settings)}
        catalog={catalog}
        catalogLoaded={catalogLoaded}
        onSettings={(patch) => asked.push(patch)}
        onStart={() => {
          started = true;
        }}
        onLeaveSolo={() => undefined}
      />,
      host
    );
  });
}

function fieldLabels(): string[] {
  return [...host.querySelectorAll('.field-label')].map((el) => el.textContent ?? '');
}

function select(label: string): HTMLSelectElement | null {
  const field = [...host.querySelectorAll('.field')].find(
    (candidate) => candidate.querySelector('.field-label')?.textContent === label
  );
  return field?.querySelector('select') ?? null;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  asked = [];
  started = false;
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

describe('solo’s own settings screen', () => {
  it('offers only games that support solo, from the catalog', () => {
    draw();
    const options = [...(select('Game')?.querySelectorAll('option') ?? [])].map((o) => o.textContent);
    expect(options).toEqual(['Fill in the blank', 'Who am I']);
    expect(options).not.toContain('Sword drill');
  });

  it('sends a setSettings patch when a different game is picked', () => {
    draw();
    const field = select('Game');
    if (field) {
      field.value = 'who-am-i';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    expect(asked).toEqual([{ gameId: 'who-am-i' }]);
  });

  it('hides Translation and Set for a game that does not use them', () => {
    draw({ gameId: 'who-am-i' });
    const labels = fieldLabels();
    expect(labels).toContain('How well known');
    expect(labels).not.toContain('Translation');
    expect(labels).not.toContain('Set');
  });

  it('shows every setting for a game that uses all three', () => {
    draw({ gameId: 'fill-in-the-blank' });
    expect(fieldLabels()).toEqual(
      expect.arrayContaining(['Game', 'Set', 'Translation', 'How well known', 'Rounds', 'Time per question'])
    );
  });

  it('lets rounds and the answer window be changed too', () => {
    draw();
    const rounds = select('Rounds');
    if (rounds) {
      rounds.value = '5';
      rounds.dispatchEvent(new Event('change', { bubbles: true }));
    }
    expect(asked).toEqual([{ rounds: 5 }]);
  });

  it('starts the game on request', () => {
    draw();
    const startButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Start');
    act(() => {
      startButton?.click();
    });
    expect(started).toBe(true);
  });

  it('still offers the room’s current game even if the catalog has not answered yet', () => {
    draw({ gameId: 'fill-in-the-blank' }, { games: [], sets: [], translations: [] });
    const options = [...(select('Game')?.querySelectorAll('option') ?? [])].map((o) => o.textContent);
    expect(options).toEqual(['Fill in the blank']);
  });
});

describe('warning when no Bible module is installed', () => {
  const noTranslations: Catalog = { games: [], sets: [], translations: [] };

  it('says nothing while the catalog is still loading', () => {
    draw({}, noTranslations, false);
    expect(host.textContent).not.toContain('No Bible module');
  });

  it('warns once the catalog has answered with no translations', () => {
    draw({}, noTranslations, true);
    expect(host.textContent).toContain('No Bible module is installed');
  });
});
