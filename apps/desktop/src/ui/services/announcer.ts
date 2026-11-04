/**
 * One app-wide polite announcer (B-113). `announce()` is a no-op until a
 * `<LiveAnnouncer />` has mounted, so tests that do not care are unaffected.
 * Messages arriving within BATCH_MS are joined in arrival order with exact
 * duplicates dropped (two synced Bible panes -> one "Romans 8."); the region is
 * cleared then set on the next tick so a repeated message is spoken again, and
 * cleared after CLEAR_MS so stale text is never re-read.
 */
export const BATCH_MS = 150;
export const SET_DELAY_MS = 50;
export const CLEAR_MS = 7000;

type Sink = (text: string, assertive: boolean) => void;
let sink: Sink | null = null;
let pending: string[] = [];
let batchTimer: ReturnType<typeof setTimeout> | undefined;
let clearTimer: ReturnType<typeof setTimeout> | undefined;
let assertivePending = false;

export function registerAnnouncerSink(s: Sink | null): void {
  sink = s;
}

type Translator = (key: string, params?: Record<string, unknown>) => string;
let translator: Translator | null = null;
export function registerAnnouncerTranslator(t: Translator | null): void {
  translator = t;
}

/** Announce a catalog message; for call sites (hooks, stores) that have no `t` of their own. */
export function announceKey(key: string, params?: Record<string, unknown>, opts?: { assertive?: boolean }): void {
  if (!translator) return;
  announce(translator(key, params), opts);
}

export function announce(message: string, opts?: { assertive?: boolean }): void {
  if (!sink || !message.trim()) return;
  if (!pending.includes(message)) pending.push(message);
  if (opts?.assertive) assertivePending = true;
  if (batchTimer) return;
  batchTimer = setTimeout(() => {
    batchTimer = undefined;
    const text = pending.join(' ');
    const assertive = assertivePending;
    pending = [];
    assertivePending = false;
    sink?.('', assertive);
    setTimeout(() => {
      sink?.(text, assertive);
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => sink?.('', assertive), CLEAR_MS);
    }, SET_DELAY_MS);
  }, BATCH_MS);
}

export function __resetAnnouncerForTests(): void {
  sink = null;
  translator = null;
  pending = [];
  assertivePending = false;
  if (batchTimer) clearTimeout(batchTimer);
  if (clearTimer) clearTimeout(clearTimer);
  batchTimer = clearTimer = undefined;
}
