// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScreenSnapshot } from '../../shared/protocol.js';
import { ClockContext } from './clockPort.js';
import { controlPanel, handClock, screenSnapshot } from './screenFixtures.js';
import { TvJoin } from './TvJoin.js';
import type { StreamFactory, StreamHandlers } from './useRoomStream.js';

interface Opened {
  url: string;
  handlers: StreamHandlers;
  closed: boolean;
}

let host: HTMLDivElement;
let opened: Opened[];
const factory: StreamFactory = (url, handlers) => {
  const stream: Opened = { url, handlers, closed: false };
  opened.push(stream);
  return {
    close() {
      stream.closed = true;
    },
  };
};

function draw(code: string | null): void {
  act(() => {
    render(
      <ClockContext.Provider value={handClock({ now: 40_000 })}>
        <TvJoin code={code} onNavigate={() => undefined} factory={factory} />
      </ClockContext.Provider>,
      host
    );
  });
}

function send(stream: Opened | undefined, event: object): void {
  act(() => {
    stream?.handlers.onMessage(JSON.stringify(event));
  });
}

function snapshotEvent(snapshot: ScreenSnapshot): object {
  return { type: 'snapshot', snapshot };
}

function type(value: string): void {
  const input = host.querySelector<HTMLInputElement>('input')!;
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function submit(): void {
  act(() => {
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  opened = [];
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

describe('the code entry', () => {
  it('asks for a code and connects to nothing until one is typed', () => {
    draw(null);
    expect(host.querySelector('input')).not.toBeNull();
    expect(opened).toEqual([]);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it('tidies what is typed into the code alphabet', () => {
    draw(null);
    type('ck-7h ');
    expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('CK7H');
  });

  it('opens a code-only stream with no token once a full code is submitted', () => {
    draw(null);
    type('5hk27');
    submit();
    expect(opened).toHaveLength(1);
    expect(opened[0]?.url).toContain('/5HK27/');
    expect(opened[0]?.url).not.toContain('token');
  });

  it('connects at once when the link carries a code', () => {
    draw('5HK27');
    expect(host.querySelector('input')).toBeNull();
    expect(opened).toHaveLength(1);
  });
});

describe('a refused code', () => {
  it('says no game uses it and lets the person type again', () => {
    draw('5HK27');
    send(opened[0], { type: 'roomClosed', reason: 'This device is no longer part of that room.' });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('No game is using that code.');
    expect(opened[0]?.closed).toBe(true);

    type('7HK2C');
    submit();
    expect(opened).toHaveLength(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('can try the same code again', () => {
    draw('5HK27');
    send(opened[0], { type: 'roomClosed', reason: 'gone' });
    submit();
    expect(opened).toHaveLength(2);
  });
});

describe('a connected screen', () => {
  it('draws the lobby the way any display screen does, with no controls', () => {
    draw('QK7P');
    send(
      opened[0],
      snapshotEvent(
        screenSnapshot({
          phase: 'lobby',
          round: -1,
          players: [{ id: 'p1', name: 'Ruth', teamId: null, connected: true }],
          phaseEndsAt: null,
          phaseDurationMs: null,
        })
      )
    );
    expect(host.querySelector('.big-code')?.textContent).toBe('QK7P');
    expect(host.textContent).toContain('Ruth');
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('input')).toBeNull();
  });

  it('draws the rules during the intro and the podium at the end', () => {
    draw('QK7P');
    send(opened[0], snapshotEvent(screenSnapshot({ phase: 'intro', round: 0 })));
    expect(host.querySelector('.how-to-play')).not.toBeNull();
    send(
      opened[0],
      snapshotEvent(
        screenSnapshot({
          phase: 'summary',
          phaseEndsAt: null,
          standings: [{ playerId: 'a', name: 'Esther', teamId: null, score: 900 }],
        })
      )
    );
    expect(host.querySelector('.podium-name')?.textContent).toBe('Esther');
  });

  it('never shows the organizer bar, whatever the snapshot carries', () => {
    draw('QK7P');
    send(opened[0], snapshotEvent(screenSnapshot({ control: controlPanel() })));
    act(() => {
      document.dispatchEvent(new Event('pointermove'));
    });
    expect(host.querySelector('.organizer-bar')).toBeNull();
  });
});
