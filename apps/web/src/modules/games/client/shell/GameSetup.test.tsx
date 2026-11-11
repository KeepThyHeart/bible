// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog, CatalogGame, GameId, RoomSettings } from '../../shared/protocol.js';
import { GameSetup } from './GameSetup.js';
import { rememberName } from './session.js';

let host: HTMLDivElement;
let submitted: { settings: Partial<RoomSettings>; player: { name: string } | null }[];

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  submitted = [];
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

function catalogFor(id: GameId, overrides: Partial<CatalogGame> = {}): Catalog {
  return {
    games: [
      {
        id,
        name: 'The game',
        scopeLabel: 'People of the Bible',
        supportsSolo: false,
        groupVote: 'none',
        usesFamiliarity: true,
        usesTranslation: true,
        usesSet: true,
        usesBuzz: false,
        ...overrides,
      },
    ],
    sets: [
      { id: 'set-1', name: 'A set', gameId: id },
      { id: 'set-2', name: 'Other game’s set', gameId: 'someone-else' },
    ],
    translations: ['KJV', 'WEB'],
  };
}

function draw(
  catalog: Catalog,
  props: { mode?: 'create' | 'change'; initial?: Partial<RoomSettings>; gameId?: GameId } = {}
): void {
  act(() => {
    render(
      <GameSetup
        gameId={props.gameId ?? 'case'}
        catalog={catalog}
        mode={props.mode ?? 'create'}
        {...(props.initial !== undefined ? { initial: props.initial } : {})}
        onSubmit={(settings, player) => submitted.push({ settings, player })}
      />,
      host
    );
  });
}

function labels(): string[] {
  return [...host.querySelectorAll('.field-label')].map((el) => el.textContent ?? '');
}

function segment(group: string, label: string): HTMLButtonElement {
  const buttons = host.querySelectorAll<HTMLButtonElement>(`.org-seg[aria-label="${group}"] button`);
  return [...buttons].find((b) => b.textContent === label)!;
}

function pressed(group: string): string[] {
  return [...host.querySelectorAll<HTMLButtonElement>(`.org-seg[aria-label="${group}"] button`)]
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent ?? '');
}

function submit(): void {
  act(() => {
    host.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function check(name: string, value: boolean): void {
  const box = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  act(() => {
    box.checked = value;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('which options a game shows', () => {
  it('shows every option when the game reads them all', () => {
    draw(catalogFor('case'));
    expect(labels()).toEqual(
      expect.arrayContaining(['Length', 'Difficulty', 'Teams', 'Time per question', 'Translation', 'Topic'])
    );
  });

  it('hides Difficulty, Translation and Topic when the game reads none of them', () => {
    draw(catalogFor('case', { usesFamiliarity: false, usesTranslation: false, usesSet: false }));
    const shown = labels();
    expect(shown).toContain('Length');
    expect(shown).toContain('Teams');
    expect(shown).not.toContain('Difficulty');
    expect(shown).not.toContain('Translation');
    expect(shown).not.toContain('Topic');
  });

  it('lists only the topics that belong to this game', () => {
    draw(catalogFor('case'));
    const options = [...host.querySelectorAll('select[name="topic"] option')].map((o) => o.textContent);
    expect(options).toEqual(['Pick for me', 'A set']);
  });

  it('shows the game’s own scope under its name', () => {
    draw(catalogFor('case'));
    expect(host.querySelector('.field-hint')?.textContent).toBe('People of the Bible');
  });

  it('offers the buzz-in choice for sword drill only', () => {
    draw(catalogFor('sword-drill'), { gameId: 'sword-drill' });
    expect(labels()).toContain('How players buzz in');
    act(() => {
      render(null, host);
    });
    draw(catalogFor('case'));
    expect(labels()).not.toContain('How players buzz in');
  });

  it('names each choice group and marks the chosen button, for assistive technology', () => {
    draw(catalogFor('case'));
    const teams = host.querySelector('.org-seg[aria-label="Teams"]')!;
    expect(teams.getAttribute('role')).toBe('group');
    expect([...teams.querySelectorAll('button')].every((b) => b.hasAttribute('aria-pressed'))).toBe(true);
  });

  it('keeps the extra options collapsed', () => {
    draw(catalogFor('case'));
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(false);
  });
});

describe('group answering', () => {
  it('offers a switch when the game makes it optional, and sends the choice', () => {
    draw(catalogFor('case', { groupVote: 'optional' }));
    check('group-vote', true);
    submit();
    expect(submitted[0]?.settings.groupVote).toBe(true);
  });

  it('states the rule instead of a switch when the game always does it', () => {
    draw(catalogFor('case', { groupVote: 'always' }));
    expect(host.querySelector('input[name="group-vote"]')).toBeNull();
    expect(host.querySelector('[role="note"]')?.textContent).toContain('The group answers together');
    submit();
    expect(submitted[0]?.settings).not.toHaveProperty('groupVote');
  });

  it('says nothing about it for a game without a vote', () => {
    draw(catalogFor('case'));
    expect(host.querySelector('input[name="group-vote"]')).toBeNull();
    expect(host.querySelector('[role="note"]')).toBeNull();
  });
});

describe('the settings it produces', () => {
  it('starts from the normal length and a mixed difficulty with no teams', () => {
    draw(catalogFor('case'));
    expect(pressed('Length')).toEqual(['Normal (10)']);
    expect(pressed('Difficulty')).toEqual(['Mixed']);
    expect(pressed('Teams')).toEqual(['None']);
    submit();
    expect(submitted[0]?.settings).toMatchObject({
      gameId: 'case',
      rounds: 10,
      familiarity: 'broad',
      teamsEnabled: false,
      answerWindowMs: 20_000,
    });
  });

  it('maps Short and Long to 5 and 15 rounds', () => {
    draw(catalogFor('case'));
    act(() => segment('Length', 'Short (5)').click());
    submit();
    act(() => segment('Length', 'Long (15)').click());
    submit();
    expect(submitted.map((entry) => entry.settings.rounds)).toEqual([5, 15]);
  });

  it('maps Keep going to an open-ended game of ten rounds a batch', () => {
    draw(catalogFor('case'));
    act(() => segment('Length', 'Long (15)').click());
    act(() => segment('Length', 'Keep going').click());
    expect(pressed('Length')).toEqual(['Keep going']);
    expect(host.textContent).toContain('No set length. Finish whenever.');
    submit();
    expect(submitted[0]?.settings).toMatchObject({ openEnded: true, rounds: 10 });
    act(() => segment('Length', 'Short (5)').click());
    submit();
    expect(submitted[1]?.settings).toMatchObject({ openEnded: false, rounds: 5 });
  });

  it('maps the three difficulties to familiar, broad and deep', () => {
    draw(catalogFor('case'));
    for (const label of ['Well known', 'Mixed', 'Hard']) {
      act(() => segment('Difficulty', label).click());
      submit();
    }
    expect(submitted.map((entry) => entry.settings.familiarity)).toEqual(['familiar', 'broad', 'deep']);
  });

  it('maps None, 2, 3 and 4 to teamsEnabled and teamCount', () => {
    draw(catalogFor('case'));
    for (const label of ['3', '4', '2', 'None']) {
      act(() => segment('Teams', label).click());
      submit();
    }
    expect(submitted.map((entry) => [entry.settings.teamsEnabled, entry.settings.teamCount])).toEqual([
      [true, 3],
      [true, 4],
      [true, 2],
      [false, 2],
    ]);
  });

  it('sends translation, topic and time from the extra options', () => {
    draw(catalogFor('case'));
    const change = (selector: string, value: string): void => {
      const select = host.querySelector<HTMLSelectElement>(selector)!;
      act(() => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    change('select[name="translation"]', 'WEB');
    change('select[name="topic"]', 'set-1');
    change('select[name="time-per-question"]', '45');
    submit();
    expect(submitted[0]?.settings).toMatchObject({ translation: 'WEB', setId: 'set-1', answerWindowMs: 45_000 });
  });

  it('sends the buzz mode in the game’s own options', () => {
    draw(catalogFor('sword-drill'), { gameId: 'sword-drill' });
    act(() => segment('How players buzz in', 'Phone buttons').click());
    submit();
    expect(submitted[0]?.settings.gameOptions).toEqual({ buzzMode: 'buttons' });
  });

  it('starts from a room’s own settings when changing, and offers no playing too', () => {
    draw(catalogFor('case'), {
      mode: 'change',
      initial: { rounds: 15, familiarity: 'deep', teamsEnabled: true, teamCount: 3 },
    });
    expect(pressed('Length')).toEqual(['Long (15)']);
    expect(pressed('Difficulty')).toEqual(['Hard']);
    expect(pressed('Teams')).toEqual(['3']);
    expect(host.querySelector('input[name="playing-too"]')).toBeNull();
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe('Save changes');
  });
});

describe('playing too', () => {
  it('is off to begin with and sends no player', () => {
    draw(catalogFor('case'));
    expect(host.querySelector<HTMLInputElement>('input[name="playing-too"]')?.checked).toBe(false);
    expect(host.querySelector('input[name="display-name"]')).toBeNull();
    submit();
    expect(submitted[0]?.player).toBeNull();
  });

  it('asks for a name, starting from the remembered one, and sends it', () => {
    rememberName('Ruth');
    draw(catalogFor('case'));
    check('playing-too', true);
    const name = host.querySelector<HTMLInputElement>('input[name="display-name"]')!;
    expect(name.value).toBe('Ruth');
    act(() => {
      name.value = '  Naomi   B ';
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    submit();
    expect(submitted[0]?.player).toEqual({ name: 'Naomi B' });
  });

  it('will not open without a name', () => {
    draw(catalogFor('case'));
    check('playing-too', true);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    submit();
    expect(submitted).toEqual([]);
  });
});
