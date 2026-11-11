// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoomCode } from '../../shared/protocol.js';
import { HomeScreen } from './HomeScreen.js';

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

function button(label: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label) ?? null;
}

function typeCode(value: string): void {
  const input = host.querySelector<HTMLInputElement>('input[name="game-code"]')!;
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the home screen', () => {
  it('offers the game code first, then running a game, then playing alone', () => {
    act(() => {
      render(<HomeScreen onJoin={() => undefined} onHost={() => undefined} onSolo={() => undefined} />, host);
    });
    const order = [...host.querySelectorAll('input, button')].map(
      (element) => element.getAttribute('name') ?? element.textContent
    );
    expect(order).toEqual(['game-code', 'Join', 'Run a game for a group', 'Play on my own']);
  });

  it('takes the typed code to the join handler, tidied', () => {
    const joined: (RoomCode | null)[] = [];
    act(() => {
      render(<HomeScreen onJoin={(code) => joined.push(code)} onHost={() => undefined} />, host);
    });
    typeCode('cd2-34');
    act(() => {
      button('Join')?.click();
    });
    expect(joined).toEqual(['CD234']);
  });

  it('joins with no code when nothing complete was typed', () => {
    const joined: (RoomCode | null)[] = [];
    act(() => {
      render(<HomeScreen onJoin={(code) => joined.push(code)} onHost={() => undefined} />, host);
    });
    typeCode('cd');
    act(() => {
      button('Join')?.click();
    });
    expect(joined).toEqual([null]);
  });

  it('sends running a game and playing alone to their own handlers', () => {
    let hosted = 0;
    let solo = 0;
    act(() => {
      render(
        <HomeScreen
          onJoin={() => undefined}
          onHost={() => {
            hosted += 1;
          }}
          onSolo={() => {
            solo += 1;
          }}
        />,
        host
      );
    });
    act(() => {
      button('Run a game for a group')?.click();
    });
    act(() => {
      button('Play on my own')?.click();
    });
    expect(hosted).toBe(1);
    expect(solo).toBe(1);
  });

  it('leaves out the solo link where there is nowhere to send it', () => {
    act(() => {
      render(<HomeScreen onJoin={() => undefined} onHost={() => undefined} />, host);
    });
    expect(button('Play on my own')).toBeNull();
  });
});
