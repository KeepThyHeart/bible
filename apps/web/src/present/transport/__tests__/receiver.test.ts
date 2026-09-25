import { describe, expect, it, beforeEach, vi } from 'vitest';
import { openPresentReceiver, type ReceiverEvent } from '../receiver';
import { openLocalChannel } from '../localChannel';
import type { PresentState } from '../../protocol';

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

function stateAt(version: number): PresentState {
  return {
    version,
    live: null,
    position: { index: 0, highlight: null },
    display: { fontStep: 5, blanked: false, theme: 'dark' },
    session: { id: 'SESSION000000000', joinCode: 'ABCD2345', joinsLocked: false, viewerCount: 0 },
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});

describe('openPresentReceiver', () => {
  it('turns a state frame from the stream into a state event', () => {
    const receiver = openPresentReceiver('ABCD2345');
    const events: ReceiverEvent[] = [];
    receiver.subscribe(e => events.push(e));

    FakeEventSource.instances[0].emit('state', stateAt(1));

    expect(events).toEqual([{ type: 'state', state: stateAt(1) }]);
    receiver.close();
  });

  it('requests the preview stream when asked to', () => {
    const receiver = openPresentReceiver('ABCD2345', { preview: true });
    expect(FakeEventSource.instances[0].url).toContain('preview=1');
    receiver.close();
  });

  it('ignores an unparsable frame rather than throwing', () => {
    const receiver = openPresentReceiver('ABCD2345');
    const onEvent = vi.fn();
    receiver.subscribe(onEvent);

    const source = FakeEventSource.instances[0];
    source.listeners.get('state')?.({ data: 'not json' } as MessageEvent<string>);

    expect(onEvent).not.toHaveBeenCalled();
    receiver.close();
  });

  it('ignores an out-of-order (older) version', () => {
    const receiver = openPresentReceiver('ABCD2345');
    const events: ReceiverEvent[] = [];
    receiver.subscribe(e => events.push(e));
    const source = FakeEventSource.instances[0];

    source.emit('state', stateAt(3));
    source.emit('state', stateAt(2));

    expect(events).toEqual([{ type: 'state', state: stateAt(3) }]);
    receiver.close();
  });

  it('emits reconnecting on a network error, without closing', () => {
    const receiver = openPresentReceiver('ABCD2345');
    const events: ReceiverEvent[] = [];
    receiver.subscribe(e => events.push(e));
    const source = FakeEventSource.instances[0];

    source.onerror?.();

    expect(events).toEqual([{ type: 'reconnecting' }]);
    expect(source.closed).toBe(false);
    receiver.close();
  });

  it('emits closed with the server-given reason, and stops the stream', () => {
    const receiver = openPresentReceiver('ABCD2345');
    const events: ReceiverEvent[] = [];
    receiver.subscribe(e => events.push(e));
    const source = FakeEventSource.instances[0];

    source.emit('closed', { reason: 'locked' });

    expect(events).toEqual([{ type: 'closed', reason: 'locked' }]);
    expect(source.closed).toBe(true);
    receiver.close();
  });

  it('does not emit reconnecting after the server has explicitly closed', () => {
    const receiver = openPresentReceiver('ABCD2345');
    const events: ReceiverEvent[] = [];
    receiver.subscribe(e => events.push(e));
    const source = FakeEventSource.instances[0];

    source.emit('closed', { reason: 'ended' });
    source.onerror?.();

    expect(events).toEqual([{ type: 'closed', reason: 'ended' }]);
    receiver.close();
  });

  it('unsubscribing stops delivery to that listener only', () => {
    const receiver = openPresentReceiver('ABCD2345');
    const a: ReceiverEvent[] = [];
    const b: ReceiverEvent[] = [];
    const unsubA = receiver.subscribe(e => a.push(e));
    receiver.subscribe(e => b.push(e));
    const source = FakeEventSource.instances[0];

    unsubA();
    source.emit('state', stateAt(1));

    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
    receiver.close();
  });

  it('merges a same-machine local-channel frame by the shared version rule', async () => {
    const receiver = openPresentReceiver('ABCD2345');
    const events: ReceiverEvent[] = [];
    receiver.subscribe(e => events.push(e));

    // A local frame arrives first, ahead of the network...
    const writer = openLocalChannel('ABCD2345');
    writer.publish(stateAt(5));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(events).toEqual([{ type: 'state', state: stateAt(5) }]);

    // ...and the network's answer to the same version wins the tie, but is
    // not re-emitted on top of it: it confirms exactly what was already
    // shown, so a subscriber (a viewer mid-render of that same state) is not
    // told about it a second time. See `renderEquivalent` in `frames.ts` --
    // this is what used to show up as a visible double flash for an item
    // whose content was still loading (a hymn) when the local prediction hit.
    FakeEventSource.instances[0].emit('state', stateAt(5));
    expect(events).toHaveLength(1);

    writer.close();
    receiver.close();
  });

  it('still emits a network frame that corrects a local guess at the same version', async () => {
    const receiver = openPresentReceiver('ABCD2345');
    const events: ReceiverEvent[] = [];
    receiver.subscribe(e => events.push(e));

    // The local prediction guessed wrong -- a blank, say, when the real
    // answer left the wall unblanked -- so the two frames render differently.
    const writer = openLocalChannel('ABCD2345');
    writer.publish({ ...stateAt(5), display: { ...stateAt(5).display, blanked: true } });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(events).toHaveLength(1);

    FakeEventSource.instances[0].emit('state', stateAt(5));
    expect(events).toEqual([
      { type: 'state', state: { ...stateAt(5), display: { ...stateAt(5).display, blanked: true } } },
      { type: 'state', state: stateAt(5) },
    ]);

    writer.close();
    receiver.close();
  });

  it('closing tears down both the stream and the local channel', () => {
    const receiver = openPresentReceiver('ABCD2345');
    const source = FakeEventSource.instances[0];
    receiver.close();
    expect(source.closed).toBe(true);
  });
});
