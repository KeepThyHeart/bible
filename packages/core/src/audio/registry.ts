/**
 * The registry shape shared by audio providers and TTS engine factories.
 *
 * Same contract as the web app's plugin registries: `register` returns the
 * function that undoes it, and registering an id that is already present
 * replaces the earlier item (the last registration wins, so a plugin can
 * override a built-in).
 */

import type { IRegistry } from './types';

export class Registry<T extends { id: string }> implements IRegistry<T> {
  private readonly items = new Map<string, T>();

  register(item: T): () => void {
    this.items.set(item.id, item);
    return () => {
      // Only remove our own registration: a later replacement must survive.
      if (this.items.get(item.id) === item) this.items.delete(item.id);
    };
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  list(): T[] {
    return Array.from(this.items.values());
  }
}
