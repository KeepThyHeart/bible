/**
 * Minimal event emitter type used by the command/context/keybinding/i18n services.
 *
 * Subscribers receive a payload of type `T`. `subscribe` returns an `IDisposable`
 * that removes the listener. Implementations should never throw out of `fire`.
 */

export interface IDisposable {
  dispose(): void;
}

export type Listener<T> = (event: T) => void;

export interface IEvent<T> {
  (listener: Listener<T>): IDisposable;
}

export class Emitter<T> {
  private listeners = new Set<Listener<T>>();

  readonly event: IEvent<T> = (listener: Listener<T>): IDisposable => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(value: T): void {
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch (err) {
        // Listeners must never break the emitter for other subscribers.
        // eslint-disable-next-line no-console
        console.error('[Emitter] listener threw:', err);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }

  get size(): number {
    return this.listeners.size;
  }
}
