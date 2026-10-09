// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog, GroupVoteMode, RoomSettings, ScreenSnapshot } from '../../shared/protocol.js';
import { DARK_THEME, DEFAULT_THEME, THEME_PRESETS } from '../../shared/theme.js';
import { HostLobby } from './HostLobby.js';

function lobby(settings: Partial<RoomSettings> = {}): ScreenSnapshot {
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
    },
  };
}

/** `exactOptionalPropertyTypes` refuses `control: undefined` in an override; this actually omits the key. */
function withoutControl(snapshot: ScreenSnapshot): ScreenSnapshot {
  const rest = { ...snapshot };
  delete rest.control;
  return rest;
}

function catalogOffering(groupVote: GroupVoteMode): Catalog {
  return {
    games: [
      {
        id: 'case',
        name: 'Case',
        supportsSolo: false,
        groupVote,
        usesFamiliarity: true,
        usesTranslation: true,
        usesSet: true,
      },
    ],
    sets: [],
    translations: ['KJV'],
  };
}

let host: HTMLDivElement;
let asked: Partial<RoomSettings>[];

function draw(groupVote: GroupVoteMode, settings: Partial<RoomSettings> = {}): void {
  act(() => {
    render(
      <HostLobby
        snapshot={lobby(settings)}
        catalog={catalogOffering(groupVote)}
        catalogLoaded={true}
        joinUrl="https://example.org/join/QK7P"
        isOwner={true}
        onSettings={(patch) => asked.push(patch)}
        onStart={() => undefined}
        onReclaim={() => undefined}
      />,
      host
    );
  });
}

function voteSwitch(): HTMLButtonElement | null {
  const field = [...host.querySelectorAll('.field')].find(
    (candidate) => candidate.querySelector('.field-label')?.textContent === 'Vote together'
  );
  return field?.querySelector('button') ?? null;
}

describe('the roster', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    asked = [];
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  it('marks a disconnected player with real text, not a CSS pseudo-element', () => {
    const snapshot = lobby();
    snapshot.players = [{ id: 'p1', name: 'Ruth', teamId: null, connected: false }];
    act(() => {
      render(
        <HostLobby
          snapshot={snapshot}
          catalog={catalogOffering('none')}
          catalogLoaded={true}
          joinUrl="https://example.org/join/QK7P"
          isOwner={true}
          onSettings={() => undefined}
          onStart={() => undefined}
          onReclaim={() => undefined}
        />,
        host
      );
    });
    const marker = host.querySelector('.away-marker');
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toBe('(away)');
    // The generated text lives in the DOM as a real node, not CSS `content`
    // (which `textContent` would not see at all).
    expect(host.querySelector('.name-grid li')?.textContent).toContain('(away)');
  });

  it('gives a long name a title attribute rather than letting it wrap the row', () => {
    const snapshot = lobby();
    const longName = 'A Genuinely Very Long Display Name';
    snapshot.players = [{ id: 'p1', name: longName, teamId: null, connected: true }];
    act(() => {
      render(
        <HostLobby
          snapshot={snapshot}
          catalog={catalogOffering('none')}
          catalogLoaded={true}
          joinUrl="https://example.org/join/QK7P"
          isOwner={true}
          onSettings={() => undefined}
          onStart={() => undefined}
          onReclaim={() => undefined}
        />,
        host
      );
    });
    const nameEl = host.querySelector('.name-text');
    expect(nameEl?.textContent).toBe(longName);
    expect(nameEl?.getAttribute('title')).toBe(longName);
  });
});

describe('game-sensitive settings, in the lobby', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    asked = [];
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  function catalogWith(overrides: Partial<Catalog['games'][number]>): Catalog {
    return {
      games: [
        {
          id: 'case',
          name: 'Case',
          scopeLabel: 'People of the Bible',
          supportsSolo: false,
          groupVote: 'none',
          usesFamiliarity: true,
          usesTranslation: true,
          usesSet: true,
          ...overrides,
        },
      ],
      sets: [{ id: 'set-1', name: 'A set', gameId: 'case' }],
      translations: ['KJV'],
    };
  }

  function fieldLabels(): string[] {
    return [...host.querySelectorAll('.field-label')].map((el) => el.textContent ?? '');
  }

  it('shows every field when the catalog says the game uses all three', () => {
    act(() => {
      render(
        <HostLobby
          snapshot={lobby()}
          catalog={catalogWith({})}
          catalogLoaded={true}
          joinUrl="https://example.org/join/QK7P"
          isOwner={true}
          onSettings={(patch) => asked.push(patch)}
          onStart={() => undefined}
          onReclaim={() => undefined}
        />,
        host
      );
    });
    expect(fieldLabels()).toEqual(
      expect.arrayContaining(['Game', 'Set', 'Translation', 'How well known'])
    );
  });

  it('hides Set, Translation and How well known when the game reads none of them', () => {
    act(() => {
      render(
        <HostLobby
          snapshot={lobby()}
          catalog={catalogWith({ usesFamiliarity: false, usesTranslation: false, usesSet: false })}
          catalogLoaded={true}
          joinUrl="https://example.org/join/QK7P"
          isOwner={true}
          onSettings={(patch) => asked.push(patch)}
          onStart={() => undefined}
          onReclaim={() => undefined}
        />,
        host
      );
    });
    const labels = fieldLabels();
    expect(labels).toContain('Game');
    expect(labels).not.toContain('Set');
    expect(labels).not.toContain('Translation');
    expect(labels).not.toContain('How well known');
  });

  it('shows the game’s own scope label under the game picker', () => {
    act(() => {
      render(
        <HostLobby
          snapshot={lobby()}
          catalog={catalogWith({})}
          catalogLoaded={true}
          joinUrl="https://example.org/join/QK7P"
          isOwner={true}
          onSettings={(patch) => asked.push(patch)}
          onStart={() => undefined}
          onReclaim={() => undefined}
        />,
        host
      );
    });
    expect(host.querySelector('.field-hint')?.textContent).toBe('People of the Bible');
  });
});

describe('warning when no Bible module is installed', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    asked = [];
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  const noTranslations: Catalog = { games: [], sets: [], translations: [] };

  it('says nothing while the catalog is still loading, even with an empty result', () => {
    act(() => {
      render(
        <HostLobby
          snapshot={lobby()}
          catalog={noTranslations}
          catalogLoaded={false}
          joinUrl="https://example.org/join/QK7P"
          isOwner={true}
          onSettings={() => undefined}
          onStart={() => undefined}
          onReclaim={() => undefined}
        />,
        host
      );
    });
    expect(host.textContent).not.toContain('No Bible module');
  });

  it('warns once the catalog has answered with no translations', () => {
    act(() => {
      render(
        <HostLobby
          snapshot={lobby()}
          catalog={noTranslations}
          catalogLoaded={true}
          joinUrl="https://example.org/join/QK7P"
          isOwner={true}
          onSettings={() => undefined}
          onStart={() => undefined}
          onReclaim={() => undefined}
        />,
        host
      );
    });
    expect(host.textContent).toContain('No Bible module is installed');
  });

  it('says nothing once the catalog answers with at least one translation', () => {
    act(() => {
      render(
        <HostLobby
          snapshot={lobby()}
          catalog={{ games: [], sets: [], translations: ['KJV'] }}
          catalogLoaded={true}
          joinUrl="https://example.org/join/QK7P"
          isOwner={true}
          onSettings={() => undefined}
          onStart={() => undefined}
          onReclaim={() => undefined}
        />,
        host
      );
    });
    expect(host.textContent).not.toContain('No Bible module');
  });
});

describe('group voting in the lobby', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    asked = [];
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  it('offers a switch for a game where voting is optional, and sends the change', () => {
    draw('optional');
    const button = voteSwitch();
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      button?.click();
    });
    expect(asked).toEqual([{ groupVote: true }]);
  });

  it('says what the switch does once it is on', () => {
    draw('optional', { groupVote: true });
    expect(voteSwitch()?.textContent).toBe('On — each team agrees one answer');
  });

  it('states the rule instead of offering a switch for a game that always votes', () => {
    draw('always', { teamsEnabled: false });
    expect(voteSwitch()).toBeNull();
    expect(host.querySelector('.vote-notice')?.textContent).toContain('The room votes together');
  });

  it('says nothing about voting for a game that does not offer it', () => {
    draw('none');
    expect(voteSwitch()).toBeNull();
    expect(host.querySelector('.vote-notice')).toBeNull();
  });
});

describe('the room theme, in the lobby', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    asked = [];
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  it('defaults to light, matching the room default', () => {
    draw('none');
    const active = [...host.querySelectorAll('.theme-preset')].find(
      (button) => button.getAttribute('aria-pressed') === 'true'
    );
    expect(active?.textContent).toBe('Light');
  });

  it('sends the whole preset when the host picks a different one', () => {
    draw('none');
    const darkButton = [...host.querySelectorAll('.theme-preset')].find(
      (button) => button.textContent === 'Dark'
    ) as HTMLButtonElement | undefined;
    act(() => {
      darkButton?.click();
    });
    expect(asked).toEqual([{ theme: THEME_PRESETS.dark }]);
  });

  it('carries its own text colour, not the active theme’s, so an unselected preset stays readable', () => {
    draw('none');
    const darkButton = [...host.querySelectorAll('.theme-preset')].find(
      (button) => button.textContent === 'Dark'
    ) as HTMLButtonElement | undefined;
    // The room is on Light, so a button whose text colour fell back to the
    // active theme's `--fg` would render Light's near-black text on Dark's
    // near-black background rather than Dark's own near-white text.
    expect(darkButton?.style.getPropertyValue('--swatch-fg')).toBe(DARK_THEME.fg);
  });

  it('offers no way to customize individual colours — built-in presets only', () => {
    draw('none');
    expect(host.querySelector('.theme-toggle')).toBeNull();
    expect(host.querySelector('input[type="color"]')).toBeNull();
  });
});

function buzzSwitch(): HTMLButtonElement | null {
  const field = [...host.querySelectorAll('.field')].find(
    (candidate) => candidate.querySelector('.field-label')?.textContent === 'How players buzz in'
  );
  return field?.querySelector('button') ?? null;
}

describe('sword drill’s buzz-in setting, in the lobby', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    asked = [];
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  it('offers no such field for a game other than sword drill', () => {
    draw('none', { gameId: 'case' });
    expect(buzzSwitch()).toBeNull();
  });

  it('defaults to host-calls, worded as such, with nothing set', () => {
    draw('none', { gameId: 'sword-drill' });
    const button = buzzSwitch();
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.textContent).toContain('Host calls');
  });

  it('switches to buttons and back, carrying the rest of gameOptions untouched', () => {
    draw('none', { gameId: 'sword-drill', gameOptions: { closeness: 'section' } });
    act(() => {
      buzzSwitch()?.click();
    });
    expect(asked).toEqual([{ gameOptions: { closeness: 'section', buzzMode: 'buttons' } }]);
  });

  it('says buttons mode when that is what is set', () => {
    draw('none', { gameId: 'sword-drill', gameOptions: { buzzMode: 'buttons' } });
    const button = buzzSwitch();
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.textContent).toContain('Phone buttons');
  });
});

describe('control in the lobby', () => {
  let reclaimed: number;
  let playedToo: number;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    asked = [];
    reclaimed = 0;
    playedToo = 0;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  function drawWith(snapshot: ScreenSnapshot, isOwner: boolean, offerPlayToo: boolean): void {
    act(() => {
      render(
        <HostLobby
          snapshot={snapshot}
          catalog={catalogOffering('none')}
          catalogLoaded={true}
          joinUrl="https://example.org/join/QK7P"
          isOwner={isOwner}
          onSettings={(patch) => asked.push(patch)}
          onStart={() => undefined}
          onReclaim={() => {
            reclaimed += 1;
          }}
          {...(offerPlayToo ? { onPlayToo: () => (playedToo += 1) } : {})}
        />,
        host
      );
    });
  }

  function textButton(label: string): HTMLButtonElement | null {
    return [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label) ?? null;
  }

  it('disables settings and Start once control has moved to a player', () => {
    const notControlling: ScreenSnapshot = {
      ...withoutControl(lobby()),
      controller: { kind: 'player', playerId: 'p-9' },
      players: [{ id: 'p-9', name: 'Ellen', teamId: null, connected: true }],
    };
    drawWith(notControlling, true, false);

    expect(host.querySelector('fieldset.settings-grid')?.hasAttribute('disabled')).toBe(true);
    expect(textButton('Start game')?.disabled).toBe(true);
    expect(host.textContent).toContain('Ellen is running the room.');
  });

  it('offers Take back control only on the owner credential, when not controlling', () => {
    const snapshot: ScreenSnapshot = {
      ...withoutControl(lobby()),
      controller: { kind: 'player', playerId: 'p-9' },
    };

    drawWith(snapshot, true, false);
    expect(textButton('Take back control')).not.toBeNull();
    act(() => textButton('Take back control')?.click());
    expect(reclaimed).toBe(1);

    act(() => {
      render(null, host);
    });
    drawWith(snapshot, false, false);
    expect(textButton('Take back control')).toBeNull();
  });

  it('offers "Play too, and run it from here" on the owner credential while controlling', () => {
    drawWith(lobby(), true, true);
    const playToo = textButton('Play too, and run it from here');
    expect(playToo).not.toBeNull();
    act(() => playToo?.click());
    expect(playedToo).toBe(1);
  });

  it('offers no way to play too without an owner session to grant control from', () => {
    drawWith(lobby(), true, false);
    expect(textButton('Play too, and run it from here')).toBeNull();
  });
});
