/** Command history: newest last, de-duplicated, persisted in localStorage (best effort). */

const KEY = 'present.command.history';
export const MAX_HISTORY = 50;

export function pushHistory(list: string[], entry: string, max = MAX_HISTORY): string[] {
  const text = entry.trim();
  if (!text) return list;
  const without = list.filter(e => e !== text);
  without.push(text);
  return without.slice(-max);
}

export function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string').slice(-MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

export function saveHistory(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_HISTORY)));
  } catch {
    // Private mode / blocked storage: history is a convenience, not state.
  }
}

/**
 * Walks history with Up/Down. `index === list.length` means "the draft" (what
 * was being typed before the first Up). Pure so the cursor rules are testable.
 */
export interface HistoryCursor { index: number; draft: string }

export function historyStart(list: string[], draft: string): HistoryCursor {
  return { index: list.length, draft };
}

export function historyOlder(list: string[], cur: HistoryCursor): { cursor: HistoryCursor; text: string } {
  const index = Math.max(0, cur.index - 1);
  return { cursor: { ...cur, index }, text: list[index] ?? cur.draft };
}

export function historyNewer(list: string[], cur: HistoryCursor): { cursor: HistoryCursor; text: string } {
  const index = Math.min(list.length, cur.index + 1);
  return { cursor: { ...cur, index }, text: index >= list.length ? cur.draft : list[index] };
}
