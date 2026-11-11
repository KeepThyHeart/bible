// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog, GameId } from '../../shared/protocol.js';
import { GamePicker } from './GamePicker.js';
import { clearGameViews, registerGameViews } from './gameViews.js';
import type { GameCard } from './gameViews.js';

let host: HTMLDivElement;

const nothing = () => null;

function register(id: GameId, card: GameCard | undefined): void {
  registerGameViews({
    id,
    host: { question: nothing, answering: nothing, reveal: nothing },
    player: { question: nothing, answering: nothing, reveal: nothing },
    ...(card !== undefined ? { card } : {}),
  });
}

function card(tags: GameCard['tags'], description = 'How it plays.'): GameCard {
  return { descriptionKey: 'games.test.card', descriptionFallback: description, tags, minutes: 10 };
}

const catalog: Catalog = {
  games: ['fill-in-the-blank', 'describe-it', 'sword-drill', 'plain'].map((id) => ({
    id,
    name: id === 'plain' ? 'Plain game' : id,
    supportsSolo: false,
    groupVote: 'none' as const,
    usesFamiliarity: true,
    usesTranslation: true,
    usesSet: true,
    usesBuzz: false,
  })),
  sets: [],
  translations: ['KJV'],
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  register('fill-in-the-blank', card(['everyone']));
  register('describe-it', card(['teams', 'outLoud']));
  register('sword-drill', card(['outLoud', 'bibles', 'fourPlus']));
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
  clearGameViews();
});

function draw(onPick: (id: GameId) => void = () => undefined): void {
  act(() => {
    render(<GamePicker catalog={catalog} onPick={onPick} />, host);
  });
}

function chip(label: string): HTMLButtonElement {
  return [...host.querySelectorAll<HTMLButtonElement>('.org-chip')].find((c) => c.textContent === label)!;
}

function shown(): string[] {
  return [...host.querySelectorAll('.org-card-name')].map((el) => el.textContent ?? '');
}

describe('the game picker', () => {
  it('lists every game under All, with its description, tags and minutes', () => {
    draw();
    expect(shown()).toEqual(['fill-in-the-blank', 'describe-it', 'sword-drill', 'Plain game']);
    const first = host.querySelector('.org-card')!;
    expect(first.textContent).toContain('How it plays.');
    expect(first.textContent).toContain('Everyone answers');
    expect(first.textContent).toContain('10 min');
    expect(host.querySelectorAll('.org-card')[2]!.textContent).toContain('Bibles needed');
    expect(host.querySelectorAll('.org-card')[2]!.textContent).toContain('4+ players');
  });

  it('offers the four filters, with All chosen to begin with', () => {
    draw();
    const chips = [...host.querySelectorAll('.org-chip')].map((c) => c.textContent);
    expect(chips).toEqual(['All', 'Quick quiz', 'Teams', 'Out loud']);
    expect(chip('All').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the games with the matching tag for each filter', () => {
    draw();
    act(() => chip('Quick quiz').click());
    expect(shown()).toEqual(['fill-in-the-blank']);
    act(() => chip('Teams').click());
    expect(shown()).toEqual(['describe-it']);
    act(() => chip('Out loud').click());
    expect(shown()).toEqual(['describe-it', 'sword-drill']);
    act(() => chip('All').click());
    expect(shown()).toHaveLength(4);
  });

  it('shows a game with no card by name alone', () => {
    draw();
    const plain = [...host.querySelectorAll('.org-card')].find((el) => el.textContent === 'Plain game');
    expect(plain).toBeDefined();
  });

  it('hands the chosen game on', () => {
    const picked: GameId[] = [];
    draw((id) => picked.push(id));
    act(() => (host.querySelectorAll<HTMLButtonElement>('.org-card')[1] as HTMLButtonElement).click());
    expect(picked).toEqual(['describe-it']);
  });
});
