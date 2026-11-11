/** The verse the reader's "Memorize" action just added, handed to the Memory page (which offers "Practice now"). */
import type { AddVersesOutcome } from '@bible/memory/api';

export interface JustAdded {
  passageId: number;
  reference: string;
  /** What the add did: the Today row says "Added", "Restored" or "already in" to match. */
  outcome: AddVersesOutcome;
}

type Listener = (added: JustAdded) => void;
let listener: Listener | null = null;
let pending: JustAdded | null = null;

/** Remember an addition: delivered at once to a mounted page, otherwise kept for its next mount. */
export function setJustAdded(added: JustAdded): void {
  if (listener) listener(added);
  else pending = added;
}

/** Read and clear an addition that arrived before the page mounted. */
export function takeJustAdded(): JustAdded | undefined {
  const added = pending ?? undefined;
  pending = null;
  return added;
}

/** The mounted page registers here; returns the unregister function. */
export function onJustAdded(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}
