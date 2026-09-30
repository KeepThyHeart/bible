import { useEffect, useState } from 'preact/hooks';
import type { PresentState } from '../protocol';
import type { LocalSession } from './localSession';

/** The session's current state, re-rendering the caller on every change. */
export function useLocalSession(session: LocalSession): PresentState {
  const [state, setState] = useState(session.getState());
  useEffect(() => {
    setState(session.getState()); // A change between render and subscribe.
    return session.subscribe(setState);
  }, [session]);
  return state;
}
