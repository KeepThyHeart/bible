import { useState, useEffect, useRef } from 'preact/hooks';
import type { Store } from '../stores/Store';

export function useStore<T>(store: Store, selector: () => T): T {
  const [, forceUpdate] = useState(0);
  const valueRef = useRef<T>(selector());

  useEffect(() => {
    const update = () => {
      valueRef.current = selector();
      forceUpdate(n => n + 1);
    };
    return store.subscribe(update);
  }, [store]);

  valueRef.current = selector();
  return valueRef.current;
}
