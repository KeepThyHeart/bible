type Listener = () => void;

export class Store {
  private listeners: Set<Listener> = new Set();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected notify(): void {
    this.listeners.forEach(fn => fn());
  }
}
