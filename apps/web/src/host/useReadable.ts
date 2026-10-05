import { useEffect, useState } from 'preact/hooks';

interface Readable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

/** Subscribe a component to a core `ReadableStore`. */
export function useReadable<T>(store: Readable<T>): T {
  const [, force] = useState(0);
  useEffect(() => {
    let last = store.getSnapshot();
    const check = () => {
      const next = store.getSnapshot();
      if (next !== last) {
        last = next;
        force((n) => n + 1);
      }
    };
    check();
    return store.subscribe(check);
  }, [store]);
  return store.getSnapshot();
}
