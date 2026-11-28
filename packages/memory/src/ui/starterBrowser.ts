/**
 * The starter-set browser: every built-in suggested list in one filterable
 * list, each with an inline preview of its verses, so a set can be read
 * before it becomes a list.
 *
 * View `{ name: 'starters'; key }`: `key` is the set whose preview is open
 * (`goStarters`), `null` for none. Typing in the search field filters the rows
 * in place (no navigation per keystroke, so focus stays in the field); the
 * query is kept at module level so the redraw after opening a preview keeps
 * the same filter. Fetched verse text is cached per set, also at module level,
 * so reopening a preview is instant.
 */

import type { PlanView, VerseText } from '../core/types';
import { SUGGESTED_LISTS, starterRange } from '../core/suggestedLists';
import type { SuggestedList } from '../core/suggestedLists';
import { button, el, replace } from './dom';
import { errorBanner } from './components';
import type { PanelHost } from './host';
import { tr } from './i18n';
import { createStarterSet } from './starterSets';
import './styles/starters.css';

/** Set key -> reference -> its verses. Only successful fetches are kept. */
const textCache = new Map<string, Map<string, VerseText[]>>();
/** The last search text, so a redraw (opening a preview) keeps the filter. */
let lastQuery = '';
/** Failures from the last add of each set, shown again after the reload redraws the screen. */
const lastFailures = new Map<string, { reference: string; error: string }[]>();

/** Test hook: forget cached text, the query and past failures. */
export function resetStarterBrowserForTests(): void {
  textCache.clear();
  lastFailures.clear();
  lastQuery = '';
}

/** Total verses a set holds (a reference the local reader cannot size counts as one). */
export function starterVerseCount(set: SuggestedList): number {
  return set.references.reduce((n, ref) => n + (starterRange(ref)?.verseCount ?? 1), 0);
}

const fold = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/** True when `query` (already folded) appears in the set's name, blurb or references. */
export function starterMatches(set: SuggestedList, query: string): boolean {
  if (query === '') return true;
  return fold([set.name, set.blurb, ...set.references].join(' \n ')).includes(query);
}

const rowId = (key: string) => `sm-starter-row-${key}`;
const previewId = (key: string) => `sm-starter-preview-${key}`;

export function renderStarterBrowser(host: PanelHost, plan: PlanView, view: { key: string | null }): HTMLElement {
  const listNames = new Set(plan.lists.map((l) => l.name));

  const header = el('div', { class: 'sm-starters-header' }, [
    button(tr('memory.ui.settings.back', 'Back'), () => host.go({ type: 'leaveStarters' }), { class: 'sm-btn sm-btn-quiet sm-starters-back' }),
    el('h2', { class: 'sm-screen-title sm-starters-title', attrs: { tabindex: '-1' }, text: tr('memory.ui.starters.title', 'Starter sets') }),
  ]);

  const hint = el('p', {
    class: 'sm-hint sm-starters-hint',
    text: tr('memory.ui.starters.hint', 'Ready-made lists of well-known verses. Open a set to read it before adding it.'),
  });

  const search = el('input', {
    class: 'sm-input sm-starters-search',
    id: 'sm-starter-search',
    type: 'search',
    placeholder: tr('memory.ui.starters.searchPlaceholder', 'Name, topic or reference'),
    attrs: { autocomplete: 'off', spellcheck: 'false' },
  });
  search.value = lastQuery;
  const searchLabel = el('label', {
    class: 'sm-starters-search-label',
    attrs: { for: 'sm-starter-search' },
    text: tr('memory.ui.starters.search', 'Search starter sets'),
  });
  const count = el('p', { class: 'sm-starters-count', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' } });
  const noMatch = el('p', { class: 'sm-hint sm-starters-none', text: tr('memory.ui.starters.noMatch', 'No starter sets match.'), hidden: true });

  const items: { set: SuggestedList; item: HTMLLIElement }[] = [];
  const list = el(
    'ul',
    { class: 'sm-starters-list', attrs: { 'aria-label': tr('memory.ui.starters.title', 'Starter sets') } },
    SUGGESTED_LISTS.map((set) => {
      const item = renderItem(host, plan, set, listNames.has(set.name), view.key === set.key);
      items.push({ set, item });
      return item;
    }),
  );

  function applyFilter(announce: boolean): void {
    const q = fold(search.value);
    let shown = 0;
    for (const { set, item } of items) {
      const match = starterMatches(set, q);
      item.hidden = !match;
      if (match) shown += 1;
    }
    noMatch.hidden = shown > 0;
    const label = tr('memory.ui.starters.resultCount', '{count, plural, one {# set} other {# sets}}', { count: shown });
    if (announce || count.textContent === '') count.textContent = label;
  }
  search.addEventListener('input', () => {
    lastQuery = search.value;
    applyFilter(true);
  });
  applyFilter(false);

  return el('section', { class: 'sm-starters' }, [
    header,
    hint,
    el('div', { class: 'sm-starters-search-row' }, [searchLabel, search, count]),
    list,
    noMatch,
  ]);
}

function renderItem(host: PanelHost, plan: PlanView, set: SuggestedList, exists: boolean, open: boolean): HTMLLIElement {
  const row = el(
    'button',
    {
      class: 'sm-starter-row',
      id: rowId(set.key),
      attrs: { type: 'button', 'aria-expanded': String(open), 'aria-controls': previewId(set.key) },
    },
    [
      el('span', { class: 'sm-starter-line' }, [
        el('span', { class: 'sm-starter-name', text: set.name }),
        exists && el('span', { class: 'sm-starter-tag', text: tr('memory.ui.starters.added', 'Added') }),
        el('span', {
          class: 'sm-starter-count',
          text: tr('memory.ui.starters.verseCount', '{count, plural, one {# verse} other {# verses}}', { count: starterVerseCount(set) }),
        }),
      ]),
      el('span', { class: 'sm-starter-blurb', text: set.blurb }),
    ],
  );
  row.addEventListener('click', () => host.go({ type: 'goStarters', key: open ? null : set.key }));

  return el('li', { class: 'sm-starter-item', attrs: { 'data-starter-key': set.key } }, [
    row,
    open && renderPreview(host, plan, set, exists, row),
  ]);
}

function renderPreview(host: PanelHost, plan: PlanView, set: SuggestedList, exists: boolean, row: HTMLButtonElement): HTMLElement {
  const cached = textCache.get(set.key) ?? new Map<string, VerseText[]>();
  textCache.set(set.key, cached);

  const textSlots = new Map<string, HTMLElement>();
  const verses = el(
    'ol',
    { class: 'sm-starter-verses' },
    set.references.map((reference) => {
      const slot = el('div', { class: 'sm-starter-text' });
      textSlots.set(reference, slot);
      const known = cached.get(reference);
      if (known) replace(slot, verseNodes(known));
      return el('li', { class: 'sm-starter-verse' }, [el('span', { class: 'sm-starter-ref', text: reference }), slot]);
    }),
  );

  const missing = set.references.filter((r) => !cached.has(r));
  const loading = el('p', { class: 'sm-starter-loading', text: tr('memory.ui.shell.loading', 'Loading...'), hidden: missing.length === 0 });
  const textError = el('div', { class: 'sm-starter-text-error' });
  if (missing.length > 0) void loadText(host, missing, cached, textSlots, loading, textError);

  const status = el('div', { class: 'sm-starter-status' });
  const failures = lastFailures.get(set.key);
  if (failures) replace(status, failures.map((f) => errorBanner(`${f.reference}: ${f.error}`)));

  const addBtn = button(
    exists ? tr('memory.ui.starters.addMissing', 'Add missing verses') : tr('memory.ui.starters.add', 'Add as a list'),
    () => void add(),
    { class: 'sm-btn sm-btn-primary sm-starter-add' },
  );

  async function add(): Promise<void> {
    addBtn.disabled = true;
    replace(status, []);
    lastFailures.delete(set.key);
    const result = await createStarterSet(host, plan, set);
    addBtn.disabled = false;
    if (!result.ok) {
      replace(status, [errorBanner(result.error)]);
      return;
    }
    const { added, failed } = result.outcome;
    if (failed.length > 0) {
      lastFailures.set(set.key, failed);
      replace(status, failed.map((f) => errorBanner(`${f.reference}: ${f.error}`)));
    }
    host.announce(
      failed.length > 0
        ? tr('memory.ui.starters.someFailed', '{name}: {added, plural, one {# verse} other {# verses}} added, {failed, plural, one {# reference} other {# references}} failed.', { name: set.name, added, failed: failed.length })
        : exists
          ? tr('memory.ui.starters.updated', '{name} is up to date.', { name: set.name })
          : tr('memory.ui.starters.created', 'Created {name} with {count, plural, one {# verse} other {# verses}}.', { name: set.name, count: added }),
    );
    // The "Added" state at once; the reload redraws it from the new plan.
    if (added > 0) {
      const line = row.querySelector('.sm-starter-line');
      if (line && !line.querySelector('.sm-starter-tag')) {
        line.querySelector('.sm-starter-name')?.after(el('span', { class: 'sm-starter-tag', text: tr('memory.ui.starters.added', 'Added') }));
      }
      addBtn.textContent = tr('memory.ui.starters.addMissing', 'Add missing verses');
      host.reload();
    }
  }

  return el(
    'div',
    { class: 'sm-starter-preview', id: previewId(set.key), attrs: { role: 'region', 'aria-labelledby': rowId(set.key) } },
    [verses, loading, textError, el('div', { class: 'sm-starter-actions' }, [addBtn]), status],
  );
}

async function loadText(
  host: PanelHost,
  references: string[],
  cached: Map<string, VerseText[]>,
  slots: Map<string, HTMLElement>,
  loading: HTMLElement,
  textError: HTMLElement,
): Promise<void> {
  const results = await Promise.all(
    references.map(async (reference) => {
      const range = starterRange(reference);
      if (!range) return false;
      const reply = await host.request({ type: 'previewVerses', startVerseId: range.startVerseId, endVerseId: range.endVerseId });
      if (!reply.ok) return false;
      cached.set(reference, reply.data.verses);
      const slot = slots.get(reference);
      if (slot) replace(slot, verseNodes(reply.data.verses));
      return true;
    }),
  );
  loading.hidden = true;
  if (results.some((ok) => !ok)) {
    replace(textError, [errorBanner(tr('memory.ui.starters.textFailed', 'The verse text could not be loaded.'))]);
  }
}

/** A passage's verses as one paragraph, verse numbers marked when it spans more than one. */
function verseNodes(verses: VerseText[]): HTMLElement[] {
  const many = verses.length > 1;
  return [
    el(
      'p',
      { class: 'sm-starter-passage' },
      verses.flatMap((v, i) => [
        i > 0 ? ' ' : null,
        many ? el('sup', { class: 'sm-starter-vnum', text: String(v.verseId % 1000) }) : null,
        v.words.join(' '),
      ]),
    ),
  ];
}
