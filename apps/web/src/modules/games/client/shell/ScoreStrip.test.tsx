// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Podium } from './Podium.js';
import { ScoreStrip } from './ScoreStrip.js';

let host: HTMLDivElement;

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

const THREE = [
  { playerId: 'a', name: 'Esther', teamId: null, score: 300 },
  { playerId: 'b', name: 'Sam', teamId: null, score: 300 },
  { playerId: 'c', name: 'Daniel', teamId: null, score: 200 },
];

describe('the score strip', () => {
  it('lists the top three with their places and scores', () => {
    act(() => render(<ScoreStrip standings={THREE} teamStandings={[]} teamsEnabled={false} />, host));
    const rows = [...host.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual(['1Esther300', '2Sam300', '3Daniel200']);
  });

  it('renders nothing when the list is empty', () => {
    act(() => render(<ScoreStrip standings={[]} teamStandings={[]} teamsEnabled={false} />, host));
    expect(host.innerHTML).toBe('');
  });

  it('shows teams instead of players when teams are on', () => {
    act(() =>
      render(
        <ScoreStrip
          standings={THREE}
          teamStandings={[
            { teamId: 'blue', score: 500, playerCount: 2 },
            { teamId: 'red', score: 700, playerCount: 2 },
          ]}
          teamsEnabled={true}
        />,
        host
      )
    );
    const rows = [...host.querySelectorAll('li')];
    expect(rows.map((li) => li.textContent)).toEqual(['1Red700', '2Blue500']);
    expect(rows[0]?.getAttribute('data-team')).toBe('red');
  });

  it('never draws more than three', () => {
    const four = [...THREE, { playerId: 'd', name: 'Micah', teamId: null, score: 100 }];
    act(() => render(<ScoreStrip standings={four} teamStandings={[]} teamsEnabled={false} />, host));
    expect(host.querySelectorAll('li')).toHaveLength(3);
  });
});

describe('the podium', () => {
  it('shows the game name and the top three', () => {
    act(() => render(<Podium gameLabel="Who said it" standings={THREE} teamStandings={[]} teamsEnabled={false} />, host));
    expect(host.querySelector('.podium-title')?.textContent).toBe('Who said it');
    expect([...host.querySelectorAll('.podium-name')].map((el) => el.textContent)).toEqual(['Esther', 'Sam', 'Daniel']);
    expect(host.querySelector('.podium-step')?.getAttribute('data-place')).toBe('1');
  });

  it('shows only the game name and a line when scores are withheld', () => {
    act(() => render(<Podium gameLabel="Who said it" standings={[]} teamStandings={[]} teamsEnabled={false} />, host));
    expect(host.querySelector('.podium')).toBeNull();
    expect(host.textContent).toContain('Well played.');
  });

  it('lists team totals when teams are on', () => {
    act(() =>
      render(
        <Podium
          gameLabel="Who said it"
          standings={THREE}
          teamStandings={[{ teamId: 'gold', score: 900, playerCount: 3 }]}
          teamsEnabled={true}
        />,
        host
      )
    );
    expect(host.querySelector('.podium-teams')?.textContent).toContain('Gold');
  });
});
