import { describe, it, expect, vi } from 'vitest';
import { createStore, fromSelector, fromZustand, type ZustandLike } from './ReadableStore';

/** A hand-rolled Zustand-shaped store, so core tests need no zustand dependency. */
function fakeZustand<T>(initial: T): ZustandLike<T> & { set(next: T): void } {
  let state = initial;
  const listeners = new Set<(s: T, prev: T) => void>();
  return {
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    set(next) {
      const prev = state;
      state = next;
      listeners.forEach((l) => l(state, prev));
    },
  };
}

describe('createStore', () => {
  it('notifies on change, skips an identical value, and stops after unsubscribe', () => {
    const store = createStore(1);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.setState(2);
    store.setState(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(2);
    store.setState((n) => n + 1);
    expect(store.getSnapshot()).toBe(3);
    off();
    store.setState(4);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('tolerates a listener that unsubscribes during notification', () => {
    const store = createStore(0);
    const calls: string[] = [];
    const offA = store.subscribe(() => {
      calls.push('a');
      offA();
    });
    store.subscribe(() => calls.push('b'));
    store.setState(1);
    store.setState(2);
    expect(calls).toEqual(['a', 'b', 'b']);
  });
});

describe('fromZustand', () => {
  it('hands out the store\'s own state object, the same one until it changes', () => {
    const z = fakeZustand({ n: 1 });
    const store = fromZustand(z);
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    z.set({ n: 2 });
    expect(store.getSnapshot()).not.toBe(first);
    expect(store.getSnapshot()).toEqual({ n: 2 });
  });

  it('adapts the (state, prev) listener to a no-argument one and unsubscribes', () => {
    const z = fakeZustand({ n: 1 });
    const store = fromZustand(z);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    z.set({ n: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith();
    off();
    z.set({ n: 3 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('fromSelector', () => {
  it('returns the selected slice and a stable identity between changes', () => {
    const source = createStore({ a: 1, list: [1, 2] });
    const list = fromSelector(source, (s) => s.list);
    const first = list.getSnapshot();
    expect(list.getSnapshot()).toBe(first);
    source.setState((s) => ({ ...s, a: 2 })); // unrelated field
    expect(list.getSnapshot()).toBe(first);
    source.setState((s) => ({ ...s, list: [3] }));
    expect(list.getSnapshot()).toEqual([3]);
  });

  it('keeps the previous snapshot when a content-equal object is selected', () => {
    const source = createStore({ a: 1, b: 1 });
    const pair = fromSelector(
      source,
      (s) => ({ a: s.a }),
      (x, y) => x.a === y.a,
    );
    const first = pair.getSnapshot();
    source.setState((s) => ({ ...s, b: 2 }));
    expect(pair.getSnapshot()).toBe(first);
    source.setState((s) => ({ ...s, a: 5 }));
    expect(pair.getSnapshot()).not.toBe(first);
    expect(pair.getSnapshot()).toEqual({ a: 5 });
  });

  it('wakes a listener only when the selected value changed', () => {
    const source = createStore({ a: 1, b: 1 });
    const a = fromSelector(source, (s) => s.a);
    const listener = vi.fn();
    const off = a.subscribe(listener);
    source.setState((s) => ({ ...s, b: 2 }));
    expect(listener).not.toHaveBeenCalled();
    source.setState((s) => ({ ...s, a: 2 }));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    source.setState((s) => ({ ...s, a: 3 }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies every subscriber of the same change, not just the first', () => {
    const source = createStore({ a: 1 });
    const a = fromSelector(source, (s) => s.a);
    const one = vi.fn();
    const two = vi.fn();
    a.subscribe(one);
    a.subscribe(two);
    source.setState({ a: 2 });
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
  });

  it('sees in-place mutation of a source that always returns the same object', () => {
    const shared = { count: 0 };
    let notify: () => void = () => {};
    const source = {
      getSnapshot: () => shared,
      subscribe(l: () => void) {
        notify = l;
        return () => {};
      },
    };
    const count = fromSelector(source, (s) => s.count);
    const listener = vi.fn();
    count.subscribe(listener);
    shared.count = 1;
    notify();
    expect(count.getSnapshot()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('composes with fromZustand', () => {
    const z = fakeZustand({ n: 1, other: 'x' });
    const n = fromSelector(fromZustand(z), (s) => s.n);
    expect(n.getSnapshot()).toBe(1);
    z.set({ n: 2, other: 'x' });
    expect(n.getSnapshot()).toBe(2);
  });
});
