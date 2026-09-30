/**
 * The input pump.
 *
 * Driven through a fake stream rather than a real TTY, because the behaviour
 * worth pinning down is the timing: that a sequence split across two reads is
 * rejoined, and that a lone ESC only becomes the escape key after the input has
 * actually gone quiet.
 */
import { describe, expect, test } from 'bun:test';

import { type Key, describeKey } from './keys';
import { type InputStream, TerminalInput, type TerminalSize } from './raw';

class FakeStream implements InputStream {
  readonly isTTY = true;
  raw = false;
  paused = true;
  private listeners: Array<(chunk: string) => void> = [];

  setRawMode(mode: boolean): void {
    this.raw = mode;
  }
  setEncoding(): void {}
  resume(): void {
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
  on(_event: 'data', listener: (chunk: string) => void): void {
    this.listeners.push(listener);
  }
  off(_event: 'data', listener: (chunk: string) => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }
  emit(chunk: string): void {
    for (const l of [...this.listeners]) l(chunk);
  }
  get listenerCount(): number {
    return this.listeners.length;
  }
}

interface Harness {
  input: TerminalInput;
  stream: FakeStream;
  keys: Key[];
  names: () => string[];
  resizes: TerminalSize[];
  fireResize: () => void;
  size: { columns: number; rows: number };
}

function harness(escapeTimeoutMs = 5): Harness {
  const stream = new FakeStream();
  const keys: Key[] = [];
  const resizes: TerminalSize[] = [];
  const size = { columns: 88, rows: 24 };
  let resizeListener: (() => void) | undefined;

  const input = new TerminalInput({
    input: stream,
    escapeTimeoutMs,
    onKey: (k) => keys.push(k),
    onResize: (s) => resizes.push(s),
    measure: () => ({ columns: size.columns, rows: size.rows }),
    onResizeSource: (listener) => {
      resizeListener = listener;
      return () => {
        resizeListener = undefined;
      };
    },
  });

  return {
    input,
    stream,
    keys,
    names: () => keys.map(describeKey),
    resizes,
    fireResize: () => resizeListener?.(),
    size,
  };
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('raw mode lifecycle', () => {
  test('start enters raw mode and subscribes; stop restores and unsubscribes', () => {
    const h = harness();

    h.input.start();
    expect(h.stream.raw).toBe(true);
    expect(h.stream.paused).toBe(false);
    expect(h.stream.listenerCount).toBe(1);

    h.input.stop();
    // Leaving raw mode set would make the user's shell appear hung.
    expect(h.stream.raw).toBe(false);
    expect(h.stream.paused).toBe(true);
    expect(h.stream.listenerCount).toBe(0);
  });

  test('start and stop are idempotent', () => {
    const h = harness();
    h.input.start();
    h.input.start();
    expect(h.stream.listenerCount).toBe(1);
    h.input.stop();
    h.input.stop();
    expect(h.stream.raw).toBe(false);
  });
});

describe('key delivery', () => {
  test('complete sequences are delivered immediately', () => {
    const h = harness();
    h.input.start();

    h.stream.emit('\x1b[A');
    h.stream.emit('a');

    expect(h.names()).toEqual(['up', 'a']);
    h.input.stop();
  });

  test('a sequence split across two reads is rejoined, not misread', () => {
    const h = harness();
    h.input.start();

    // This is the bug the pending buffer exists to prevent: without it, the
    // first chunk would decode as `escape` and the rest as stray characters.
    h.stream.emit('\x1b[1');
    expect(h.names()).toEqual([]);
    h.stream.emit(';2A');

    expect(h.names()).toEqual(['shift+up']);
    h.input.stop();
  });

  test('ctrl+c is delivered as a key — raw mode means no SIGINT', async () => {
    const h = harness();
    h.input.start();

    h.stream.emit('\x03');

    expect(h.names()).toEqual(['ctrl+c']);
    h.input.stop();
  });
});

describe('the escape ambiguity', () => {
  test('a lone ESC is not delivered until the input goes quiet', async () => {
    const h = harness(20);
    h.input.start();

    h.stream.emit('\x1b');
    expect(h.names()).toEqual([]); // still ambiguous

    await settle(40);
    expect(h.names()).toEqual(['escape']);
    h.input.stop();
  });

  test('ESC followed quickly by [ A is an arrow key, never escape', async () => {
    const h = harness(20);
    h.input.start();

    h.stream.emit('\x1b');
    h.stream.emit('[A');
    await settle(40);

    expect(h.names()).toEqual(['up']);
    h.input.stop();
  });

  test('ESC then a letter after the timeout is escape, then the letter', async () => {
    const h = harness(10);
    h.input.start();

    h.stream.emit('\x1b');
    await settle(30);
    h.stream.emit('n');

    expect(h.names()).toEqual(['escape', 'n']);
    h.input.stop();
  });

  test('ESC then a letter within the timeout is alt+letter', async () => {
    const h = harness(30);
    h.input.start();

    h.stream.emit('\x1bn');
    await settle(50);

    expect(h.names()).toEqual(['alt+n']);
    h.input.stop();
  });
});

describe('resize', () => {
  test('reports the new size when the terminal changes', () => {
    const h = harness();
    h.input.start();

    h.size.columns = 120;
    h.size.rows = 40;
    h.fireResize();

    expect(h.resizes).toEqual([{ columns: 120, rows: 40 }]);
    h.input.stop();
  });

  test('no resize callbacks arrive after stop', () => {
    const h = harness();
    h.input.start();
    h.input.stop();

    h.fireResize();

    expect(h.resizes).toEqual([]);
  });

  test('size() reads the current dimensions', () => {
    const h = harness();
    expect(h.input.size()).toEqual({ columns: 88, rows: 24 });
  });
});
