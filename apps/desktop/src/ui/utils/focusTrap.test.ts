import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { activateFocusTrap } from './focusTrap';

describe('activateFocusTrap initial focus', () => {
  let frames: FrameRequestCallback[];
  let opener: HTMLButtonElement;
  let container: HTMLDivElement;

  beforeEach(() => {
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    opener = document.createElement('button');
    container = document.createElement('div');
    container.innerHTML = '<button data-id="first">First</button><button data-id="second">Second</button>';
    document.body.append(opener, container);
    opener.focus();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    opener.remove();
    container.remove();
  });

  const button = (id: string) => container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
  const runFrames = () => frames.splice(0).forEach((cb) => cb(0));

  it('moves focus to the first focusable element on the next frame', () => {
    const trap = activateFocusTrap(container, { inertBackground: false });
    expect(document.activeElement).toBe(opener);
    runFrames();
    expect(document.activeElement).toBe(button('first'));
    trap.release();
  });

  it('leaves focus alone when it moved into the container before that frame', () => {
    const trap = activateFocusTrap(container, { inertBackground: false });
    // A click (or the dialog's own code) lands focus inside before the frame fires.
    button('second').focus();
    runFrames();
    expect(document.activeElement).toBe(button('second'));
    trap.release();
  });
});
