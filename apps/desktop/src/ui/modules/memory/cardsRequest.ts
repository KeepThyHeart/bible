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

type PracticeListener = (passageId: number) => void;
let practiceListener: PracticeListener | null = null;
let practicePending: number | null = null;

/** The mounted view registers here; returns the unregister function. */
export function onMemoryPracticeRequest(listener: PracticeListener): () => void {
  practiceListener = listener;
  return () => {
    if (practiceListener === listener) practiceListener = null;
  };
}

/** Ask the Memory app to start practicing a passage: now if mounted, otherwise when it next mounts. */
export function requestMemoryPractice(passageId: number): void {
  if (practiceListener) practiceListener(passageId);
  else practicePending = passageId;
}

/** Read and clear a practice request that arrived before the view mounted. */
export function takePendingMemoryPractice(): number | null {
  const pending = practicePending;
  practicePending = null;
  return pending;
}

/** Act on a Memory link route such as `cards` once the app is open. */
export function openMemoryRoute(route: string): void {
  if (route === 'cards') requestMemoryCards();
}

