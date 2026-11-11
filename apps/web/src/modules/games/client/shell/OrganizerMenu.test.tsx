// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostCommand, RoomSettings, Standing } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { OrganizerMenu } from './OrganizerMenu.js';

const SETTINGS: RoomSettings = {
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
};

let host: HTMLDivElement;
let commands: HostCommand[];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  commands = [];
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

function draw(full: Standing[] | null = null): void {
  act(() => {
    render(
      <OrganizerMenu
        players={[{ id: 'p-1', name: 'Sam', teamId: null, connected: true }]}
        settings={SETTINGS}
        fullStandings={full}
        onCommand={(command) => commands.push(command)}
      />,
      host
    );
  });
}

const toggle = () => host.querySelector<HTMLButtonElement>('.host-menu-toggle')!;
const items = () => [...host.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
const item = (label: string) => items().find((entry) => entry.textContent?.trim() === label)!;
const open = () => act(() => toggle().click());

function key(target: Element | null, k: string): void {
  act(() => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

describe('the "..." menu', () => {
  it('lists its items in order', () => {
    draw();
    open();
    expect(items().map((entry) => entry.textContent?.trim())).toEqual([
      'Scores',
      'Players and teams',
      'Time per question',
      'No set length',
      'Restart with different options',
      'Finish this game',
    ]);
  });

  it('focuses the first item, moves with the arrows and closes on Escape back to the button', () => {
    draw();
    open();
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0] ?? null, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(document.activeElement, 'End');
    expect(document.activeElement).toBe(items()[items().length - 1]);
    key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(items()[0]);
    key(document.activeElement, 'Escape');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
  });

  it('opens on ArrowDown from the button', () => {
    draw();
    toggle().focus();
    key(toggle(), 'ArrowDown');
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('asks for the scores and shows them', () => {
    draw([{ playerId: 'p-1', name: 'Sam', teamId: null, score: 300 }]);
    open();
    act(() => item('Scores').click());
    expect(commands).toEqual([{ cmd: 'requestFullStandings' }]);
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Sam');
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it('opens the roster', () => {
    draw();
    open();
    act(() => item('Players and teams').click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Sam');
  });

  it('offers the time choices and sends the one picked', () => {
    draw();
    open();
    act(() => item('Time per question').click());
    expect(items().map((entry) => entry.textContent?.trim()).slice(0, 7)).toEqual([
      '10 seconds',
      '15 seconds',
      '20 seconds',
      '30 seconds',
      '45 seconds',
      '60 seconds',
      '90 seconds',
    ]);
    expect(item('20 seconds').getAttribute('aria-checked')).toBe('true');
    act(() => item('45 seconds').click());
    expect(commands).toEqual([{ cmd: 'setSettings', settings: { answerWindowMs: 45_000 } }]);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it('restarts only after a confirm, staying in the same room', () => {
    draw();
    open();
    act(() => item('Restart with different options').click());
    expect(commands).toEqual([]);
    const confirm = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Restart')!;
    act(() => confirm.click());
    expect(commands).toEqual([{ cmd: 'newGame' }]);
  });

  it('finishes the game only after a confirm', () => {
    draw();
    open();
    act(() => item('Finish this game').click());
    expect(commands).toEqual([]);
    const confirm = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Finish')!;
    act(() => confirm.click());
    expect(commands).toEqual([{ cmd: 'finish' }]);
  });

  it('never offers End for everyone', () => {
    draw();
    open();
    expect(host.textContent).not.toContain('End for everyone');
  });

  it('toggles having no set length', () => {
    draw();
    open();
    expect(item('No set length').getAttribute('aria-checked')).toBe('false');
    act(() => item('No set length').click());
    expect(commands).toEqual([{ cmd: 'setSettings', settings: { openEnded: true } }]);
  });
});
