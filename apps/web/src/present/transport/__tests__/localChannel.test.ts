import { describe, expect, it, vi } from 'vitest';
import { openLocalChannel } from '../localChannel';
import type { PresentState } from '../../protocol';

function stateAt(version: number): PresentState {
  return {
    version,
    live: null,
    position: { index: 0, highlight: null },
    display: { fontStep: 5, blanked: false, theme: 'dark' },
    session: { id: 'SESSION000000000', joinCode: 'ABCD2345', joinsLocked: false, viewerCount: 0 },
  };
}

describe('the same-machine channel', () => {
  it('delivers a publish from one handle to another on the same join code', async () => {
    const writer = openLocalChannel('ABCD2345');
    const reader = openLocalChannel('ABCD2345');
    try {
      const received = new Promise<PresentState>(resolve => {
        reader.subscribe(resolve);
      });
      writer.publish(stateAt(7));
      expect((await received).version).toBe(7);
    } finally {
      writer.close();
      reader.close();
    }
  });

  it('keeps two sessions apart', async () => {
    const a = openLocalChannel('AAAA1111');
    const b = openLocalChannel('BBBB2222');
    try {
      const heard = vi.fn();
      b.subscribe(heard);
      a.publish(stateAt(1));
      // Give any (wrongly) cross-delivered message a turn to arrive.
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(heard).not.toHaveBeenCalled();
    } finally {
      a.close();
      b.close();
    }
  });

  it('unsubscribing stops delivery without closing the channel for others', async () => {
    const writer = openLocalChannel('ABCD2345');
    const reader = openLocalChannel('ABCD2345');
    try {
      const heard = vi.fn();
      const unsubscribe = reader.subscribe(heard);
      unsubscribe();
      writer.publish(stateAt(1));
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(heard).not.toHaveBeenCalled();
    } finally {
      writer.close();
      reader.close();
    }
  });

  it('degrades to a harmless no-op without BroadcastChannel', () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error -- simulating an environment without it.
    delete globalThis.BroadcastChannel;
    try {
      const channel = openLocalChannel('ABCD2345');
      expect(() => channel.publish(stateAt(1))).not.toThrow();
      const unsubscribe = channel.subscribe(() => { /* never called */ });
      expect(() => unsubscribe()).not.toThrow();
      expect(() => channel.close()).not.toThrow();
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });

  it('returns a no-op channel for an empty join code', () => {
    const channel = openLocalChannel('');
    expect(() => channel.publish(stateAt(1))).not.toThrow();
    channel.close();
  });
});
