import { describe, it, expect, vi } from 'vitest';
import { fromSelector, type ReadableStore } from '@bible/core/browser';
import { Store } from './Store';

class CounterStore extends Store {
  count = 0;
  label = 'a';

  increment(): void {
    this.count++;
    this.notify();
  }

  rename(label: string): void {
    this.label = label;
    this.notify();
  }
}

describe('Store as a ReadableStore', () => {
  it('is assignable to ReadableStore and snapshots to itself, with its state', () => {
    const store = new CounterStore();
    const readable: ReadableStore<CounterStore> = store;
    expect(readable.getSnapshot()).toBe(store);
    store.increment();
    expect(readable.getSnapshot().count).toBe(1);
  });

  it('keeps the existing subscribe/notify behaviour', () => {
    const store = new CounterStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.increment();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.increment();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('drives fromSelector: a field selection changes only when that field does', () => {
    const store = new CounterStore();
    const count = fromSelector(store, (s) => s.count);
    const listener = vi.fn();
    count.subscribe(listener);
    store.rename('b');
    expect(listener).not.toHaveBeenCalled();
    store.increment();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(count.getSnapshot()).toBe(1);
  });
});
