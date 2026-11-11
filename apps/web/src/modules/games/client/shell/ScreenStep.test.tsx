// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScreenStep } from './ScreenStep.js';

let host: HTMLDivElement;
let calls: string[];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  calls = [];
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

function draw(usesBuzz = false, playingToo = false): void {
  act(() => {
    render(
      <ScreenStep
        code="5HK27"
        tvAddress="keepthyheart.com/games/tv"
        usesBuzz={usesBuzz}
        playingToo={playingToo}
        onUseThisDevice={() => calls.push('device')}
        onNoScreen={() => calls.push('none')}
        onContinue={() => calls.push('continue')}
      />,
      host
    );
  });
}

function button(label: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === label) ?? null;
}

describe('the big screen step', () => {
  it('tells the TV what to open and type, with the code large', () => {
    draw();
    expect(host.textContent).toContain('On the TV or projector computer, open keepthyheart.com/games/tv and type');
    expect(host.querySelector('.org-code')?.textContent).toBe('5HK27');
  });

  it('has three ways on', () => {
    draw();
    act(() => button('Continue')?.click());
    act(() => button('Use this device as the screen instead')?.click());
    act(() => button('No big screen, play on phones only')?.click());
    expect(calls).toEqual(['continue', 'device', 'none']);
  });

  it('says a game with a buzz-in race is easier to run from a phone, beside the use-this-device choice', () => {
    draw(true);
    expect(host.textContent).toContain('This game is easier to run from a phone.');
    act(() => {
      render(null, host);
    });
    draw(false);
    expect(host.textContent).not.toContain('easier to run from a phone');
  });

  it('does not offer this device as the screen to an organizer who is playing', () => {
    draw(true, true);
    expect(button('Use this device as the screen instead')).toBeNull();
    expect(host.textContent).not.toContain('easier to run from a phone');
  });
});
