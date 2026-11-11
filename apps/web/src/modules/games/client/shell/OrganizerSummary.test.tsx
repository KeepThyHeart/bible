// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ControlPanel, HostCommand } from '../../shared/protocol.js';
import { OrganizerSummary } from './OrganizerSummary.js';

function panel(overrides: Partial<ControlPanel> = {}): ControlPanel {
  return {
    pendingJudge: null,
    requests: [],
    answeredCount: 0,
    standings: [],
    teamStandings: [],
    overallStandings: [
      { playerId: 'p-1', name: 'Esther', teamId: null, score: 900 },
      { playerId: 'p-2', name: 'Sam', teamId: null, score: 800 },
      { playerId: 'p-3', name: 'Daniel', teamId: null, score: 700 },
      { playerId: 'p-4', name: 'Ruth', teamId: null, score: 100 },
    ],
    spent: [],
    answer: null,
    ...overrides,
  };
}

let host: HTMLDivElement;
let commands: HostCommand[];
let picked: number;

function draw(overrides: Partial<ControlPanel> = {}): void {
  act(() => {
    render(
      <OrganizerSummary
        panel={panel(overrides)}
        onCommand={(command) => commands.push(command)}
        onPickAnother={() => {
          picked += 1;
        }}
      />,
      host
    );
  });
}

const button = (label: string): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label)!;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  commands = [];
  picked = 0;
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

describe('the organizer’s summary', () => {
  it('says the game is over and names the top of the session so far', () => {
    draw();

    expect(host.querySelector('h2')?.textContent).toBe('Game over');
    expect(host.textContent).toContain('Tonight so far:');
    const names = [...host.querySelectorAll('.tonight-name')].map((node) => node.textContent);
    expect(names).toEqual(['Esther', 'Sam', 'Daniel']);
  });

  it('leaves the totals out when nobody has scored yet', () => {
    draw({ overallStandings: [] });

    expect(host.textContent).not.toContain('Tonight so far:');
  });

  it('offers Keep going first, with its hint, and sends continueGame', () => {
    draw();
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels.slice(0, 2)).toEqual(['Keep going', 'Play again']);
    expect(host.textContent).toContain('Same game, same scores.');
    act(() => button('Keep going').click());
    expect(commands).toEqual([{ cmd: 'continueGame' }]);
  });

  it('plays again by starting a new game and then starting it, in that order', () => {
    draw();
    act(() => button('Play again').click());

    expect(commands).toEqual([{ cmd: 'newGame' }, { cmd: 'start' }]);
  });

  it('hands over to the picker for another game without sending anything', () => {
    draw();
    act(() => button('Pick another game').click());

    expect(picked).toBe(1);
    expect(commands).toEqual([]);
  });

  it('asks before ending for everyone, and sends nothing until confirmed', () => {
    draw();
    act(() => button('End for everyone').click());

    expect(commands).toEqual([]);
    expect(host.textContent).toContain('End the game for everyone?');
    expect(document.activeElement).toBe(button('Cancel'));

    act(() => button('End for everyone').click());
    expect(commands).toEqual([{ cmd: 'end' }]);
  });

  it('goes back to the three choices when the confirm is cancelled', () => {
    draw();
    act(() => button('End for everyone').click());
    act(() => button('Cancel').click());

    expect(host.textContent).not.toContain('End the game for everyone?');
    expect(commands).toEqual([]);
    expect(button('Play again')).toBeDefined();
  });
});
