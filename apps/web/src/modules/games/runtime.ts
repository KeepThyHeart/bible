/**
 * Where Games reports "a room is open on the host screen". The module code
 * (`module.ts`) wires the sink to the app registry's busy flag and live badge;
 * the app view calls `reportGamesLive`. Entry-chunk safe: it imports nothing.
 */
let sink: ((live: boolean) => void) | null = null;
let live = false;

export function setGamesLiveSink(fn: ((live: boolean) => void) | null): void {
  sink = fn;
  fn?.(live);
}

export function reportGamesLive(next: boolean): void {
  live = next;
  sink?.(next);
}

export function resetGamesRuntimeForTest(): void {
  sink = null;
  live = false;
}
