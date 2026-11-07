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
    const unsubscribe = store.subscribe(update);
    // The store may have changed between the render and this effect (effects run after
    // paint), when nobody was listening yet: catch up, or the component keeps a stale value.
    if (!Object.is(selector(), valueRef.current)) update();
    return unsubscribe;
  }, [store]);

  valueRef.current = selector();
  return valueRef.current;
}
