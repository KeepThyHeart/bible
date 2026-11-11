// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, ScreenSnapshot } from '../../shared/protocol.js';
import { OrganizerBar } from './OrganizerBar.js';
import type { BarTimers } from './OrganizerBar.js';
import { controlPanel, screenSnapshot } from './screenFixtures.js';

let host: HTMLDivElement;
let commands: HostCommand[];

/** Timers the test steps by hand, so nothing waits. */
function handTimers(): BarTimers & { fire(): void; pending(): number } {
  const tasks = new Map<number, () => void>();
  let next = 1;
  return {
    set(task) {
      tasks.set(next, task);
      return next++;
    },
    clear(handle) {
      tasks.delete(handle as number);
    },
    fire() {
      const due = [...tasks.values()];
      tasks.clear();
      for (const task of due) task();
    },
    pending: () => tasks.size,
  };
}

let timers: ReturnType<typeof handTimers>;

function controlling(overrides: Partial<ScreenSnapshot> = {}): ScreenSnapshot {
  return screenSnapshot({ control: controlPanel(), ...overrides });
}

function draw(shown: ScreenSnapshot): void {
  act(() => {
    render(<OrganizerBar snapshot={shown} onCommand={(command) => commands.push(command)} timers={timers} />, host);
  });
}

function moveMouse(): void {
  act(() => {
    document.dispatchEvent(new Event('pointermove'));
  });
}

function press(key: string, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function button(label: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label) ?? null;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  commands = [];
  timers = handTimers();
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

describe('showing and hiding', () => {
  it('stays out of sight until the pointer moves', () => {
    draw(controlling());
    expect(host.querySelector('.organizer-bar')).toBeNull();
    moveMouse();
    expect(host.querySelector('.organizer-bar')).not.toBeNull();
  });

  it('hides again once the delay passes', () => {
    draw(controlling());
    moveMouse();
    act(() => timers.fire());
    expect(host.querySelector('.organizer-bar')).toBeNull();
  });

  it('starts the delay over on each movement', () => {
    draw(controlling());
    moveMouse();
    moveMouse();
    expect(timers.pending()).toBe(1);
  });

  it('asks for the 3 second delay by default', () => {
    const delays: number[] = [];
    const recording: BarTimers = {
      set(_task, ms) {
        delays.push(ms);
        return 1;
      },
      clear: () => undefined,
    };
    act(() => {
      render(<OrganizerBar snapshot={controlling()} onCommand={() => undefined} timers={recording} />, host);
    });
    moveMouse();
    expect(delays).toEqual([3000]);
  });

  it('stays while the pointer is on it', () => {
    draw(controlling());
    moveMouse();
    act(() => {
      host.querySelector('.organizer-bar')?.dispatchEvent(new Event('pointerenter'));
    });
    act(() => timers.fire());
    expect(host.querySelector('.organizer-bar')).not.toBeNull();
    act(() => {
      host.querySelector('.organizer-bar')?.dispatchEvent(new Event('pointerleave'));
    });
    act(() => timers.fire());
    expect(host.querySelector('.organizer-bar')).toBeNull();
  });

  it('renders nothing, and listens for nothing, on a screen without control', () => {
    draw(screenSnapshot());
    moveMouse();
    expect(host.innerHTML).toBe('');
    press(' ');
    expect(commands).toEqual([]);
  });

  it('works with the real timers too', () => {
    vi.useFakeTimers();
    act(() => {
      render(<OrganizerBar snapshot={controlling()} onCommand={() => undefined} />, host);
    });
    moveMouse();
    expect(host.querySelector('.organizer-bar')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(host.querySelector('.organizer-bar')).toBeNull();
    vi.useRealTimers();
  });
});

describe('the buttons', () => {
  it('has the main action for the phase, Pause and Skip', () => {
    draw(controlling({ phase: 'answering' }));
    moveMouse();
    act(() => button('Show the answer')?.click());
    act(() => button('Pause')?.click());
    act(() => button('Skip')?.click());
    expect(commands).toEqual([{ cmd: 'revealNow' }, { cmd: 'pause' }, { cmd: 'skip' }]);
  });

  it('offers Resume while paused', () => {
    draw(controlling({ paused: true }));
    moveMouse();
    expect(button('Pause')).toBeNull();
    act(() => button('Resume')?.click());
    expect(commands).toEqual([{ cmd: 'resume' }]);
  });

  it('starts the game from the lobby, with no Pause or Skip', () => {
    draw(controlling({ phase: 'lobby', players: [{ id: 'p', name: 'Ruth', teamId: null, connected: true }] }));
    moveMouse();
    expect(button('Pause')).toBeNull();
    expect(button('Skip')).toBeNull();
    act(() => button('Start with 1 players')?.click());
    expect(commands).toEqual([{ cmd: 'start' }]);
  });
});

describe('keys', () => {
  it('Space runs the main action and does not scroll the page', () => {
    draw(controlling({ phase: 'reveal' }));
    const event = press(' ');
    expect(commands).toEqual([{ cmd: 'nextRound' }]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Enter runs the main action', () => {
    draw(controlling({ phase: 'answering' }));
    press('Enter');
    expect(commands).toEqual([{ cmd: 'revealNow' }]);
  });

  it('P pauses, and resumes when paused', () => {
    draw(controlling());
    press('p');
    draw(controlling({ paused: true }));
    press('P');
    expect(commands).toEqual([{ cmd: 'pause' }, { cmd: 'resume' }]);
  });

  it('waits for the room to move before a second press counts, so a double Space never skips a question', () => {
    draw(controlling({ phase: 'reveal' }));
    press(' ');
    press(' ');
    expect(commands).toEqual([{ cmd: 'nextRound' }]);
    draw(controlling({ phase: 'answering', round: 1 }));
    press(' ');
    expect(commands).toEqual([{ cmd: 'nextRound' }, { cmd: 'revealNow' }]);
  });

  it('sends one pause for a double P', () => {
    draw(controlling());
    press('p');
    press('p');
    expect(commands).toEqual([{ cmd: 'pause' }]);
  });

  it('ignores keys typed into a field', () => {
    draw(controlling());
    const input = document.createElement('input');
    document.body.appendChild(input);
    press(' ', input);
    press('Enter', input);
    press('p', input);
    input.remove();
    expect(commands).toEqual([]);
  });

  it('leaves Enter on a focused button to the button, so it does not run twice', () => {
    draw(controlling({ phase: 'answering' }));
    moveMouse();
    press('Enter', button('Skip') as HTMLButtonElement);
    expect(commands).toEqual([]);
  });

  it('ignores keys with a modifier held', () => {
    draw(controlling());
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
    });
    expect(commands).toEqual([]);
  });

  it('does nothing for P in the lobby or on the summary', () => {
    draw(controlling({ phase: 'lobby' }));
    press('p');
    draw(controlling({ phase: 'summary' }));
    press('p');
    press(' ');
    expect(commands).toEqual([]);
  });
});

describe('a judgement waiting', () => {
  const SECRET_TYPED = 'Melchizedek the typed guess';
  const SECRET_CANON = 'Zerubbabel the real answer';
  const SECRET_NOTE = 'accept the short form';
  const SECRET_PREVIEW = 'Bartimaeus';

  function judging(): ScreenSnapshot {
    return controlling({
      phase: 'answering',
      control: controlPanel({
        answer: SECRET_PREVIEW,
        pendingJudge: {
          question: 'Who rebuilt the temple?',
          canonicalAnswer: SECRET_CANON,
          accept: ['Zerubbabel', SECRET_CANON],
          contextNote: SECRET_NOTE,
          seenPrefix: 'Who rebuilt',
          playerAnswer: SECRET_TYPED,
          playerId: 'p-1',
          suggestion: { verdict: 'correct', reason: 'Matches the accepted spelling' },
        },
      }),
    });
  }

  it('stays up without any pointer movement', () => {
    draw(judging());
    expect(host.querySelector('.organizer-bar')).not.toBeNull();
    expect(host.textContent).toContain('Answer to check');
  });

  it('sends the verdict for Correct and Incorrect', () => {
    draw(judging());
    act(() => button('Correct')?.click());
    act(() => button('Incorrect')?.click());
    expect(commands).toEqual([
      { cmd: 'judge', verdict: 'correct' },
      { cmd: 'judge', verdict: 'incorrect' },
    ]);
  });

  it('puts no player answer, expected answer, note, suggestion or answer card in the DOM', () => {
    draw(judging());
    moveMouse();
    const html = host.innerHTML;
    for (const secret of [SECRET_TYPED, SECRET_CANON, SECRET_NOTE, SECRET_PREVIEW, 'Matches the accepted', 'Who rebuilt']) {
      expect(html).not.toContain(secret);
    }
  });

  it('never draws the answer card, even with nothing to judge', () => {
    draw(controlling({ control: controlPanel({ answer: SECRET_PREVIEW }) }));
    moveMouse();
    expect(host.innerHTML).not.toContain(SECRET_PREVIEW);
  });

  it('draws no judge section once the judgement is ruled on', () => {
    draw(judging());
    draw(controlling());
    expect(host.querySelector('.organizer-bar')).toBeNull();
  });
});
