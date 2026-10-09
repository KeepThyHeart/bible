// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('the home screen', () => {
  it('sends "Join a room" and "Host a room" to their own handlers', () => {
    let joined = 0;
    let hosted = 0;
    act(() => {
      render(
        <HomeScreen
          onJoin={() => {
            joined += 1;
          }}
          onHost={() => {
            hosted += 1;
          }}
        />,
        host
      );
    });

    act(() => {
      button('Join a room')?.click();
    });
    expect(joined).toBe(1);
    expect(hosted).toBe(0);

    act(() => {
      button('Host a room')?.click();
    });
    expect(hosted).toBe(1);
  });

  it('gives joining the primary button and hosting the quieter one', () => {
    act(() => {
      render(<HomeScreen onJoin={() => undefined} onHost={() => undefined} />, host);
    });
    expect(button('Join a room')?.className).toContain('btn-primary');
    expect(button('Host a room')?.className).toContain('btn-quiet');
  });
});
