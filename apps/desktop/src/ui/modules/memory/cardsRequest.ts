/** "Open the card stack" requests (notification click), shared by the module wiring and the app view. */

type CardsListener = () => void;
let cardsListener: CardsListener | null = null;
let cardsPending = false;

/** The mounted view registers here; returns the unregister function. */
export function onMemoryCardsRequest(listener: CardsListener): () => void {
  cardsListener = listener;
  return () => {
    if (cardsListener === listener) cardsListener = null;
  };
}

/** Ask the Memory app to show its push cards: now if mounted, otherwise when it next mounts. */
export function requestMemoryCards(): void {
  if (cardsListener) cardsListener();
  else cardsPending = true;
}

/** Read and clear a request that arrived before the view mounted. */
export function takePendingMemoryCards(): boolean {
  const pending = cardsPending;
  cardsPending = false;
  return pending;
}

/** Act on a Memory link route such as `cards` once the app is open. */
export function openMemoryRoute(route: string): void {
  if (route === 'cards') requestMemoryCards();
}

