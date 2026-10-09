// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ControlPanel as ControlPanelData, HostCommand } from '../../shared/protocol.js';
import { ControlPanel } from './ControlPanel.js';

function pendingJudge(
  overrides: Partial<NonNullable<ControlPanelData['pendingJudge']>> = {}
): ControlPanelData['pendingJudge'] {
  return {
    playerId: 'p-1',
    question: 'Who was the mother-in-law of Ruth?',
    canonicalAnswer: 'Naomi',
    accept: ['Naomi'],
    contextNote: null,
    seenPrefix: 'Who was the',
    playerAnswer: 'naomi',
    suggestion: null,
    ...overrides,
  };
}

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

function draw(pending: ControlPanelData['pendingJudge']): void {
  act(() => {
    render(
      <ControlPanel pendingJudge={pending} onCommand={(command) => commands.push(command)} />,
      host
    );
  });
}

function button(label: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(label)) ?? null;
}

describe('the judge card', () => {
  it('renders nothing without a pending judge', () => {
    draw(null);
    expect(host.innerHTML).toBe('');
  });

  it('is built from pendingJudge alone: what was said, what was expected, and the accept list', () => {
    draw(pendingJudge({ playerAnswer: 'a very particular phrase', canonicalAnswer: 'the right answer', accept: ['the right answer', 'right answer'] }));
    expect(host.textContent).toContain('a very particular phrase');
    expect(host.textContent).toContain('the right answer');
    expect(host.textContent).toContain('right answer');
  });

  it('shows a provider’s suggestion when one is offered', () => {
    draw(pendingJudge({ suggestion: { verdict: 'correct', reason: 'Close enough' } }));
    expect(host.textContent).toContain('correct');
    expect(host.textContent).toContain('Close enough');
  });

  it('offers no suggestion line when none was given', () => {
    draw(pendingJudge({ suggestion: null }));
    expect(host.querySelector('.judge-suggestion')).toBeNull();
  });

  it('sends the three verdicts, and nothing else, as HostCommands', () => {
    draw(pendingJudge());
    act(() => button('Correct')?.click());
    act(() => button('Incorrect')?.click());
    act(() => button('Ask to be specific')?.click());
    expect(commands).toEqual([
      { cmd: 'judge', verdict: 'correct' },
      { cmd: 'judge', verdict: 'incorrect' },
      { cmd: 'judge', verdict: 'askToBeSpecific' },
    ]);
  });
});
