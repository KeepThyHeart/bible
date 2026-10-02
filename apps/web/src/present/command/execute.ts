/**
 * Turning a parsed `Command` into `PresentIntent`s on an `IntentSink`.
 *
 * How things are said today (protocol.ts / reducer.ts):
 *  - a passage is `show` of the whole chapter with `index` = the verse to sit on
 *    (the send rail does the same); a verse range is `show` of a narrowed item
 *    (`verseStart`/`verseEnd`) anchored at its first verse;
 *  - a verse within what is already live is a plain `goTo`, which keeps the
 *    screen from re-flashing the chapter;
 *  - a hymn is `show` of `{ kind: 'hymn', hymnId, verseOrder? }`;
 *  - blank/unblank are two intents, chosen from the current display state.
 */

import type { PresentIntent, PresentItem, PresentPassageItem, PresentState } from '../protocol';
import type { HymnSummary } from '../hymns';
import type { IntentSink } from '../intentSink';
import type { Command } from './command';

export type { IntentSink };

export type ExecuteFailure =
  | 'empty'
  /** Bare verse with nothing on screen to be "in". */
  | 'noPassage'
  | 'noTranslation'
  | 'hymnNotFound'
  | 'hymnUnavailable'
  | 'searchDisabled';

export type ExecuteResult = { ok: true } | { ok: false; reason: ExecuteFailure };

export interface ExecuteDeps {
  sink: IntentSink;
  /** Current wall state: for blank toggling and relative (bare-verse) commands. */
  state: PresentState | null;
  /** Translation when the command names none. */
  defaultModule?: string;
  /** Hymn library search; required for hymn commands. */
  searchHymns?: (query: string) => Promise<HymnSummary[]>;
  /** Called with every hymn summary seen, so the app can name them. */
  rememberHymns?: (hymns: HymnSummary[]) => void;
  /** Search handler; absent means search is disabled (solo viewer). */
  onSearch?: (query: string) => void;
  onHelp?: () => void;
}

const ok: ExecuteResult = { ok: true };
const fail = (reason: ExecuteFailure): ExecuteResult => ({ ok: false, reason });

function livePassage(state: PresentState | null): PresentPassageItem | null {
  return state?.live?.kind === 'passage' ? state.live : null;
}

/** Show a passage, preferring `goTo` when the verse is already inside what is live. */
export function showPassage(
  sink: IntentSink,
  state: PresentState | null,
  target: { module: string; book: number; chapter: number; verseStart?: number; verseEnd?: number },
): void {
  const { module, book, chapter, verseStart, verseEnd } = target;
  const live = livePassage(state);
  const sameChapter = live !== null && live.module === module && live.book === book && live.chapter === chapter;

  if (verseStart === undefined) {
    sink({ type: 'show', item: { kind: 'passage', module, book, chapter }, index: 1 });
    return;
  }
  if (verseEnd !== undefined && verseEnd !== verseStart) {
    sink({ type: 'show', item: { kind: 'passage', module, book, chapter, verseStart, verseEnd }, index: verseStart });
    return;
  }
  if (sameChapter) {
    const first = live.verseStart ?? 1;
    const last = live.verseEnd ?? Infinity;
    if (verseStart >= first && verseStart <= last) {
      sink({ type: 'goTo', index: verseStart });
      return;
    }
  }
  sink({ type: 'show', item: { kind: 'passage', module, book, chapter }, index: verseStart });
}

/**
 * The verse order to send for a hymn and a typed verse list. Verses the hymn
 * does not have are dropped; when the hymn has a refrain and the list did not
 * mention `R`, the refrain follows each verse (design Q9). A list containing `R`
 * is taken exactly as written. Returns undefined for "the hymn's own order".
 */
export function buildVerseOrder(verses: string[], hymn: Pick<HymnSummary, 'verseCount' | 'hasRefrain'>): string[] | undefined {
  if (verses.length === 0) return undefined;
  const valid = verses.filter(v => v === 'R' ? hymn.hasRefrain : Number(v) >= 1 && Number(v) <= hymn.verseCount);
  if (valid.length === 0 || valid.every(v => v === 'R')) return undefined;
  if (valid.includes('R') || !hymn.hasRefrain) return valid;
  return valid.flatMap(v => [v, 'R']);
}

/** Choose the hymn a number or title means from library search hits. */
export function pickHymn(hits: HymnSummary[], want: { number?: string; title?: string }): HymnSummary | null {
  if (hits.length === 0) return null;
  if (want.number && !want.title) {
    return hits.find(h => h.hymnals.some(r => r.number === want.number)) ?? null;
  }
  const title = (want.title ?? '').toLowerCase();
  return hits.find(h => h.title.toLowerCase() === title)
    ?? hits.find(h => h.title.toLowerCase().startsWith(title))
    ?? hits[0];
}

export function hymnItem(hymn: HymnSummary, verses: string[] = []): PresentItem {
  const verseOrder = buildVerseOrder(verses, hymn);
  return verseOrder ? { kind: 'hymn', hymnId: hymn.id, verseOrder } : { kind: 'hymn', hymnId: hymn.id };
}

export async function executeCommand(cmd: Command, deps: ExecuteDeps): Promise<ExecuteResult> {
  const { sink, state } = deps;
  switch (cmd.type) {
    case 'none':
      return fail('empty');

    case 'blank':
      sink({ type: state?.display.blanked ? 'unblank' : 'blank' });
      return ok;

    case 'clear':
      sink({ type: 'clearHighlights' });
      return ok;

    case 'help':
      deps.onHelp?.();
      return ok;

    case 'search':
      if (!deps.onSearch) return fail('searchDisabled');
      deps.onSearch(cmd.query);
      return ok;

    case 'passage': {
      const module = cmd.module ?? deps.defaultModule ?? livePassage(state)?.module;
      if (!module) return fail('noTranslation');
      showPassage(sink, state, { module, book: cmd.book, chapter: cmd.chapter, verseStart: cmd.verseStart, verseEnd: cmd.verseEnd });
      return ok;
    }

    case 'verse': {
      const live = livePassage(state);
      if (!live) return fail('noPassage');
      showPassage(sink, state, {
        module: live.module, book: live.book, chapter: live.chapter,
        verseStart: cmd.verseStart, verseEnd: cmd.verseEnd,
      });
      return ok;
    }

    case 'hymn': {
      if (!deps.searchHymns) return fail('hymnUnavailable');
      let hits: HymnSummary[];
      try {
        hits = await deps.searchHymns(cmd.title ?? cmd.number ?? '');
      } catch {
        return fail('hymnUnavailable');
      }
      deps.rememberHymns?.(hits);
      const hymn = pickHymn(hits, cmd);
      if (!hymn) return fail('hymnNotFound');
      sink({ type: 'show', item: hymnItem(hymn, cmd.verses), index: 0 });
      return ok;
    }
  }
}
