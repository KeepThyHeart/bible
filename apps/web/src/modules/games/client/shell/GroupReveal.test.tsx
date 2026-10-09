// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GroupResult } from '../../shared/protocol.js';
import { GroupReveal } from './GroupReveal.js';

let host: HTMLDivElement;

function draw(groups: GroupResult[]): void {
  act(() => {
    render(<GroupReveal groups={groups} />, host);
  });
}

describe('how each team voted', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  it('names each team, what it chose, and how it split', () => {
    draw([
      {
        teamId: 'red',
        split: [
          { label: 'Moses', count: 2 },
          { label: 'Aaron', count: 1 },
        ],
        decided: 'Moses',
        correct: true,
      },
      { teamId: 'blue', split: [{ label: 'Aaron', count: 2 }], decided: 'Aaron', correct: false },
    ]);

    const cards = [...host.querySelectorAll('.group-card')];
    expect(cards.map((card) => card.querySelector('.group-name')?.textContent)).toEqual(['Red', 'Blue']);
    expect(cards[0]?.textContent).toContain('Moses — right');
    expect(cards[1]?.textContent).toContain('Aaron — not this time');
    expect(
      [...(cards[0]?.querySelectorAll('.group-split li') ?? [])].map((row) => row.textContent)
    ).toEqual(['Moses2', 'Aaron1']);
  });

  it('says so when a group was split or did not vote', () => {
    draw([
      {
        teamId: 'red',
        split: [
          { label: 'Moses', count: 1 },
          { label: 'Aaron', count: 1 },
        ],
        decided: null,
        correct: null,
      },
      { teamId: 'blue', split: [], decided: null, correct: null },
    ]);
    expect(host.textContent).toContain('Split — no answer');
    expect(host.textContent).toContain('No votes');
  });

  it('calls a single teamless group the room', () => {
    draw([{ teamId: null, split: [{ label: 'Moses', count: 3 }], decided: 'Moses', correct: true }]);
    expect(host.querySelector('.group-name')?.textContent).toBe('The room');
  });
});
