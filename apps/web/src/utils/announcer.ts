/**
 * One polite live region for the whole app (`LiveRegion`), so chapter loads and
 * search result counts reach a screen reader without moving focus (WCAG 4.1.3).
 * Call `announce()` from any component; the text is cleared first so a repeat of
 * the same message is announced again.
 */
type Listener = (message: string) => void;

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function announce(message: string): void {
  if (!message) return;
  clearTimeout(timer);
  for (const l of listeners) l('');
  timer = setTimeout(() => { for (const l of listeners) l(message); }, 60);
}

export function subscribeAnnouncements(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
