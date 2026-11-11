// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SentCard } from './SentCard.js';
import {
  AWAITING_REVEAL,
  AWAITING_ROUND,
  sentLabel,
  waitingForAnswer,
  waitingForOrganizer,
  waitingForPlayers,
  waitingForTurn,
} from './waitingCopy.js';

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

describe('waiting copy', () => {
  it('keeps the two original states', () => {
    expect(AWAITING_ROUND).toBe('Getting the question ready…');
    expect(AWAITING_REVEAL).toBe('Waiting for the answer.');
  });

  it('says what each wait is for', () => {
    expect(waitingForAnswer()).toBe('Waiting for the answer.');
    expect(waitingForOrganizer()).toBe('Waiting for the organizer.');
    expect(waitingForTurn('Ruth')).toBe('Waiting for Ruth.');
    expect(waitingForPlayers(1)).toBe('Waiting for 1 more player.');
    expect(waitingForPlayers(3)).toBe('Waiting for 3 more players.');
  });

  it('shows what was sent, then what is awaited', () => {
    act(() => {
      render(<SentCard answer="LORD" />, host);
    });

    const lines = [...(host.querySelector('.sent-card')?.children ?? [])].map((node) => node.textContent);
    expect(lines).toEqual([sentLabel(), 'LORD', 'Waiting for the answer.']);
  });

  it('lets a game name a different wait', () => {
    act(() => {
      render(<SentCard answer="Moses" waiting={waitingForPlayers(2)} />, host);
    });

    expect(host.textContent).toContain('Waiting for 2 more players.');
    expect(host.textContent).not.toContain('Waiting for the answer.');
  });
});
