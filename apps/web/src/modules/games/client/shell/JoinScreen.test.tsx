// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JoinScreen } from './JoinScreen.js';

let host: HTMLDivElement;

function draw(error: string | null = null): void {
  act(() => {
    render(
      <JoinScreen initialCode="" initialName="" busy={false} error={error} onJoin={() => undefined} onSolo={() => undefined} />,
      host
    );
  });
}

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

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

// 0209 R2 W14 item 2.
describe('the room code field', () => {
  it('explains the allowed characters when it drops some, and says so no more once clean', () => {
    draw();
    const input = host.querySelector<HTMLInputElement>('input[name="room-code"]')!;
    type(input, 'abcd2345');
    expect(input.value).toBe('CD2345');
    const status = host.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('Room codes only use these characters: 2 3 4 5 6 7 8 9 C D E F H J K M');

    type(input, 'zzzz');
    expect(input.value).toBe('');
    expect(host.querySelector('[role="status"]')!.textContent).toContain('Room codes only use these characters');

    type(input, 'cd23');
    expect(host.querySelector('[role="status"]')!.textContent).not.toContain('Room codes only use');
  });

  it('does not complain about spaces and dashes, which are only tidied away', () => {
    draw();
    const input = host.querySelector<HTMLInputElement>('input[name="room-code"]')!;
    type(input, 'cd2-34');
    expect(input.value).toBe('CD234');
    expect(host.querySelector('[role="status"]')!.textContent).not.toContain('Room codes only use');
  });

  it('takes focus back after a refused join', () => {
    draw();
    (host.querySelector('input[name="display-name"]') as HTMLInputElement).focus();
    expect(document.activeElement).not.toBe(host.querySelector('input[name="room-code"]'));
    draw('No room is using that code. Check the code on the big screen.');
    expect(document.activeElement).toBe(host.querySelector('input[name="room-code"]'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No room is using');
  });
});
