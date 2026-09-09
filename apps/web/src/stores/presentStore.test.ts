import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { presentStore, type ControllerSession } from './presentStore';
import type { PresentPlanEntry, PresentState } from '../present/protocol';

/**
 * The controller's half of a session.
 *
 * What is worth testing here is not the HTTP -- the route tests cover that --
 * but the decisions this store makes when the answer is not the happy one: a
 * session that has ended under it, a save that failed, a held arrow key. Those
 * are the moments that happen mid-service, and they are the ones a presenter
 * cannot debug from the front of a room.
 */

const SESSION: ControllerSession = {
  sessionId: 'K3M7QP2XR5TV8W0Y',
  joinCode: 'ABCD2345',
  controlToken: 'Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0Z2FycGx5',
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

function stateAt(version: number): PresentState {
  return {
    version,
    live: { kind: 'passage', module: 'KJV', book: 43, chapter: 3 },
    position: { index: 16, highlight: null },
    display: { fontStep: 5, blanked: false, theme: 'dark' },
    session: { id: SESSION.sessionId, joinCode: SESSION.joinCode, joinsLocked: false, viewerCount: 2 },
  };
}

/** A stand-in for EventSource that never delivers anything on its own. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, handler);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  localStorage.clear();
});

afterEach(() => {
  presentStore.leave();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Holding a session
// ---------------------------------------------------------------------------

describe('resuming a session', () => {
  it('picks up a session this device already held', () => {
    localStorage.setItem('present-controller-session', JSON.stringify(SESSION));
    fetchMock.mockResolvedValue(respond(200, { plan: [] }));

    presentStore.restore(null);

    expect(presentStore.session).toEqual(SESSION);
    // Reloading the controller must not require the presenter to do anything;
    // a laptop that went to sleep mid-service comes back driving the same wall.
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('drops a session that has already expired', () => {
    // Offering to resume it would only produce a 410 on the first press.
    localStorage.setItem('present-controller-session', JSON.stringify({
      ...SESSION, expiresAt: new Date(Date.now() - 1000).toISOString(),
    }));
    presentStore.restore(null);
    expect(presentStore.session).toBeNull();
  });

  it('prefers a session handed to it over one it was holding', () => {
    localStorage.setItem('present-controller-session', JSON.stringify(SESSION));
    fetchMock.mockResolvedValue(respond(200, { plan: [] }));

    const handed = { ...SESSION, sessionId: 'AAAABBBBCCCCDDDD', joinCode: 'ZZZZ2345' };
    presentStore.restore(handed);

    expect(presentStore.session?.sessionId).toBe('AAAABBBBCCCCDDDD');
  });

  it('ignores unreadable storage rather than refusing to start', () => {
    localStorage.setItem('present-controller-session', 'not json');
    presentStore.restore(null);
    expect(presentStore.session).toBeNull();
  });

  it('watches the same stream the viewers do', () => {
    // This is where the viewer count comes from, and it is what keeps the strip
    // honest when a second device is driving.
    localStorage.setItem('present-controller-session', JSON.stringify(SESSION));
    fetchMock.mockResolvedValue(respond(200, { plan: [] }));
    presentStore.restore(null);

    expect(FakeEventSource.instances[0].url).toContain(`/j/${SESSION.joinCode}/stream`);
    // But not as one of them. The count answers "is the television connected?",
    // and a controller that counted itself would always answer at least one --
    // the wrong answer to the only question the number is asked.
    expect(FakeEventSource.instances[0].url).toContain('preview=1');
  });
});

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

describe('sending intents', () => {
  beforeEach(() => {
    localStorage.setItem('present-controller-session', JSON.stringify(SESSION));
    fetchMock.mockResolvedValue(respond(200, { plan: [] }));
    presentStore.restore(null);
    fetchMock.mockReset();
  });

  it('sends the control token as a header, never in the URL', async () => {
    fetchMock.mockResolvedValue(respond(200, { state: stateAt(2) }));
    await presentStore.send({ type: 'next' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(SESSION.controlToken);
    expect((init.headers as Record<string, string>)['X-Present-Token']).toBe(SESSION.controlToken);
  });

  it('adopts the state the response carries without waiting for the broadcast', async () => {
    // On venue wifi the round trip through the stream is the difference between
    // a strip that responds and one that feels broken.
    fetchMock.mockResolvedValue(respond(200, { state: stateAt(7) }));
    await presentStore.send({ type: 'next' });
    expect(presentStore.wall?.version).toBe(7);
  });

  it('lets go of a session that has ended under it', async () => {
    fetchMock.mockResolvedValue(respond(410, {}));
    await presentStore.send({ type: 'next' });

    expect(presentStore.session).toBeNull();
    expect(presentStore.error).toBeTruthy();
    expect(localStorage.getItem('present-controller-session')).toBeNull();
  });

  it('keeps the session when a single intent fails', async () => {
    // A dropped request is not a dead session, and the next press may work.
    fetchMock.mockRejectedValue(new Error('network'));
    await presentStore.send({ type: 'next' });

    expect(presentStore.session).toEqual(SESSION);
    expect(presentStore.error).toBeTruthy();
  });

  it('swallows a repeated arrow key rather than flooding the wire', async () => {
    fetchMock.mockResolvedValue(respond(200, { state: stateAt(2) }));
    await presentStore.step('next');
    await presentStore.step('next');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blanks and unblanks from whatever the wall is currently doing', async () => {
    fetchMock.mockResolvedValue(respond(200, { state: stateAt(2) }));
    await presentStore.toggleBlank();
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string))
      .toEqual({ intent: { type: 'blank' } });

    presentStore.wall = { ...stateAt(3), display: { fontStep: 5, blanked: true, theme: 'dark' } };
    await presentStore.toggleBlank();
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string))
      .toEqual({ intent: { type: 'unblank' } });
  });
});

// ---------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------

describe('following the stream', () => {
  beforeEach(() => {
    localStorage.setItem('present-controller-session', JSON.stringify(SESSION));
    fetchMock.mockResolvedValue(respond(200, { plan: [] }));
    presentStore.restore(null);
  });

  it('takes new state and reports the connection live', () => {
    FakeEventSource.instances[0].emit('state', stateAt(4));
    expect(presentStore.wall?.version).toBe(4);
    expect(presentStore.connection).toBe('live');
  });

  it('takes a newer viewer count off an older frame without going backwards', () => {
    // The count rides along on state frames but changes without the version
    // moving, so a late frame still has something worth reading.
    FakeEventSource.instances[0].emit('state', stateAt(9));
    const older = stateAt(4);
    older.session.viewerCount = 5;
    FakeEventSource.instances[0].emit('state', older);

    expect(presentStore.wall?.version).toBe(9);
    expect(presentStore.wall?.session.viewerCount).toBe(5);
  });

  it('ends the session locally when the server closes the stream', () => {
    FakeEventSource.instances[0].emit('closed', { reason: 'ended' });
    expect(presentStore.session).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The running order
// ---------------------------------------------------------------------------

describe('the running order', () => {
  const entry = (id: string): PresentPlanEntry => ({
    id, item: { kind: 'passage', module: 'KJV', book: 43, chapter: 3 },
  });

  beforeEach(() => {
    localStorage.setItem('present-controller-session', JSON.stringify(SESSION));
    fetchMock.mockResolvedValue(respond(200, { plan: [] }));
    presentStore.restore(null);
    fetchMock.mockReset();
  });

  it('reorders by moving one entry to where another is', async () => {
    presentStore.plan = [entry('a'), entry('b'), entry('c')];
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(respond(200, JSON.parse(init.body as string))));

    await presentStore.reorderPlan('c', 'a');
    expect(presentStore.plan.map(e => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('does nothing when an entry is dropped on itself', async () => {
    presentStore.plan = [entry('a'), entry('b')];
    await presentStore.reorderPlan('a', 'a');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a new entry unnamed, for the server to name', async () => {
    // Ids come from the server so it can guarantee they do not collide.
    fetchMock.mockResolvedValue(respond(200, { plan: [entry('server-made')] }));
    await presentStore.addToPlan({ kind: 'passage', module: 'KJV', book: 43, chapter: 3 });

    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.plan[0].id).toBe('');
    expect(presentStore.plan.map((e: PresentPlanEntry) => e.id)).toEqual(['server-made']);
  });

  it('keeps the edit on screen when the save fails', async () => {
    // Losing what a presenter just typed because the wifi hiccupped is worse
    // than a running order that is briefly only on this device.
    presentStore.plan = [entry('a')];
    fetchMock.mockRejectedValue(new Error('network'));

    await presentStore.savePlan([entry('a'), entry('b')]);
    expect(presentStore.plan.map(e => e.id)).toEqual(['a', 'b']);
    expect(presentStore.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Leaving
// ---------------------------------------------------------------------------

describe('leaving versus ending', () => {
  beforeEach(() => {
    localStorage.setItem('present-controller-session', JSON.stringify(SESSION));
    fetchMock.mockResolvedValue(respond(200, { plan: [] }));
    presentStore.restore(null);
    fetchMock.mockReset();
  });

  it('leaving sends nothing, so the screen keeps what it has', () => {
    presentStore.leave();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(presentStore.session).toBeNull();
  });

  it('leaving closes the stream rather than leaking it', () => {
    presentStore.leave();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('ending tells the server before letting go', async () => {
    fetchMock.mockResolvedValue(respond(200, { state: stateAt(2), ended: true }));
    await presentStore.end();

    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string))
      .toEqual({ intent: { type: 'end' } });
    expect(presentStore.session).toBeNull();
  });
});
