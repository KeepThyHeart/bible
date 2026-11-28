/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ListSummary, PanelReply, PanelRequest, PlanView, RequestMap, Rung } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import type { Flow, NavAction } from '../src/ui/state';
import { WordMeasurer } from '../src/ui/measure';
import { renderStarterBrowser, resetStarterBrowserForTests, starterVerseCount } from '../src/ui/starterBrowser';
import { SUGGESTED_LISTS, starterRange } from '../src/core/suggestedLists';

function plan(lists: ListSummary[] = [{ id: 1, name: 'Default', passageCount: 0, verseCount: 0 }]): PlanView {
  return {
    collectionId: 1, collectionName: 'Default', lists, scope: 'all', scopeVerseCount: 0,
    referenceActivitiesUnlocked: false, sortOrder: 'bible', passages: [], totalDue: 0,
    speech: { state: 'unavailable', missingPermissions: [], engineLabel: '', onDevice: false, handsFree: false },
    reciteDueCount: 0, cardsWaiting: 0, defaultAnswerMode: 'firstLetter',
  } as PlanView;
}

class Host implements PanelHost {
  requests: PanelRequest[] = [];
  navigations: NavAction[] = [];
  announcements: string[] = [];
  reloads = 0;
  activeReference: string | null = null;
  handlers: Record<string, (r: any) => PanelReply<any>> = {};
  readonly measurer = new WordMeasurer(document);
  now() { return 0; }
  request<R extends PanelRequest>(request: R): Promise<PanelReply<RequestMap[R['type']]>> {
    this.requests.push(request);
    const h = this.handlers[request.type];
    return Promise.resolve(h ? h(request) : { ok: false, error: `No stub for ${request.type}` });
  }
  go(a: NavAction) { this.navigations.push(a); }
  reload() { this.reloads += 1; }
  async startSession(_p: number, _r?: Rung) {}
  async startFlow(_f: Flow) { return true; }
  openInBible() {}
  announce(m: string) { this.announcements.push(m); }
}

/** previewVerses stub: one verse per id, text "v<id>". */
function previewStub(r: { startVerseId: number; endVerseId: number }): PanelReply<any> {
  const verses = [];
  for (let id = r.startVerseId; id <= r.endVerseId; id++) {
    verses.push({ verseId: id, label: '', words: ['text', `v${id}`], lines: null, psalmTitle: null, paragraphStart: false });
  }
  return { ok: true, data: { reference: '', verses } };
}

let host: Host;
let container: HTMLElement;
beforeEach(() => {
  resetStarterBrowserForTests();
  host = new Host();
  container = document.createElement('div');
  container.className = 'sm-app';
  document.body.appendChild(container);
});
afterEach(() => { container.remove(); });

const settle = () => new Promise((r) => setTimeout(r, 0));
const text = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ').trim();
function mount(p: PlanView = plan(), key: string | null = null): HTMLElement {
  container.innerHTML = '';
  const root = renderStarterBrowser(host, p, { key });
  container.appendChild(root);
  return root;
}
const visibleRows = (root: HTMLElement) => [...root.querySelectorAll<HTMLLIElement>('.sm-starter-item')].filter((li) => !li.hidden);
const rowOf = (root: HTMLElement, key: string) => root.querySelector<HTMLButtonElement>(`#sm-starter-row-${key}`)!;
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('starter browser: list', () => {
  it('shows the header, the hint, a labelled search field and one row per set', () => {
    const root = mount();
    expect(text(root.querySelector('h2.sm-screen-title')!)).toBe('Starter sets');
    expect(root.querySelector('h2')!.getAttribute('tabindex')).toBe('-1');
    const search = root.querySelector<HTMLInputElement>('input.sm-starters-search')!;
    expect(root.querySelector(`label[for="${search.id}"]`)).not.toBeNull();
    expect(visibleRows(root).length).toBe(SUGGESTED_LISTS.length);
    const first = SUGGESTED_LISTS[0]!;
    const row = rowOf(root, first.key);
    expect(text(row)).toContain(first.name);
    expect(text(row)).toContain(first.blurb);
    expect(text(row)).toContain(`${starterVerseCount(first)} verses`);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(text(root.querySelector('[aria-live="polite"]')!)).toBe(`${SUGGESTED_LISTS.length} sets`);
  });

  it('Back leaves the browser', () => {
    const root = mount();
    [...root.querySelectorAll('button')].find((b) => text(b) === 'Back')!.click();
    expect(host.navigations).toEqual([{ type: 'leaveStarters' }]);
  });

  it('tags a set whose list already exists', () => {
    const set = SUGGESTED_LISTS[2]!;
    const root = mount(plan([{ id: 1, name: 'Default', passageCount: 0, verseCount: 0 }, { id: 4, name: set.name, passageCount: 1, verseCount: 6 }]));
    expect(rowOf(root, set.key).querySelector('.sm-starter-tag')?.textContent).toBe('Added');
    expect(root.querySelectorAll('.sm-starter-tag').length).toBe(1);
  });

  it('filters in place by name, blurb and reference, and announces the count', () => {
    const root = mount();
    const search = root.querySelector<HTMLInputElement>('input.sm-starters-search')!;
    search.focus();
    type(search, 'psalm 139');
    expect(visibleRows(root).map((li) => li.dataset.starterKey)).toEqual(['psalm-139']);
    expect(text(root.querySelector('[aria-live="polite"]')!)).toBe('1 set');
    expect(document.activeElement).toBe(search);
    expect(host.navigations).toEqual([]);

    type(search, 'Ephesians 6:10');
    expect(visibleRows(root).map((li) => li.dataset.starterKey)).toEqual(['armor-of-god']);

    type(search, 'whole');
    expect(visibleRows(root).length).toBeGreaterThan(1);

    type(search, 'zzzz');
    expect(visibleRows(root).length).toBe(0);
    expect((root.querySelector('.sm-starters-none') as HTMLElement).hidden).toBe(false);
    expect(text(root.querySelector('[aria-live="polite"]')!)).toBe('0 sets');
  });

  it('keeps the query across a redraw', () => {
    type(mount().querySelector<HTMLInputElement>('input.sm-starters-search')!, 'grief');
    const again = mount(plan(), 'comfort-in-grief');
    expect(again.querySelector<HTMLInputElement>('input.sm-starters-search')!.value).toBe('grief');
    expect(visibleRows(again).map((li) => li.dataset.starterKey)).toEqual(['comfort-in-grief']);
  });

  it('a row opens its preview through goStarters, and an open row closes it', () => {
    const set = SUGGESTED_LISTS[1]!;
    rowOf(mount(), set.key).click();
    expect(host.navigations).toEqual([{ type: 'goStarters', key: set.key }]);
    host.handlers.previewVerses = previewStub;
    const open = mount(plan(), set.key);
    const row = rowOf(open, set.key);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(open.querySelector(`#${row.getAttribute('aria-controls')}`)).not.toBeNull();
    row.click();
    expect(host.navigations.at(-1)).toEqual({ type: 'goStarters', key: null });
  });
});

describe('starter browser: preview', () => {
  const set = SUGGESTED_LISTS.find((s) => s.key === 'romans-road')!;

  it('lists each reference, loads its text, and caches it for the next open', async () => {
    host.handlers.previewVerses = previewStub;
    const root = mount(plan(), set.key);
    const preview = root.querySelector('.sm-starter-preview')!;
    expect([...preview.querySelectorAll('.sm-starter-ref')].map(text)).toEqual(set.references);
    expect((preview.querySelector('.sm-starter-loading') as HTMLElement).hidden).toBe(false);
    await settle();
    expect((preview.querySelector('.sm-starter-loading') as HTMLElement).hidden).toBe(true);
    const r = starterRange('Romans 10:9-10')!;
    expect(host.requests).toContainEqual({ type: 'previewVerses', startVerseId: r.startVerseId, endVerseId: r.endVerseId });
    expect(text(preview)).toContain(`v${r.startVerseId}`);
    expect(text(preview)).toContain(`v${r.endVerseId}`);

    const before = host.requests.length;
    const again = mount(plan(), set.key);
    expect(host.requests.length).toBe(before);
    expect(text(again.querySelector('.sm-starter-preview')!)).toContain(`v${r.startVerseId}`);
    expect((again.querySelector('.sm-starter-loading') as HTMLElement).hidden).toBe(true);
  });

  it('shows the references and an error line when the text fails to load', async () => {
    host.handlers.previewVerses = () => ({ ok: false, error: 'no module' });
    const root = mount(plan(), set.key);
    await settle();
    const preview = root.querySelector('.sm-starter-preview')!;
    expect([...preview.querySelectorAll('.sm-starter-ref')].map(text)).toEqual(set.references);
    expect(text(preview.querySelector('[role="alert"]')!)).toBe('The verse text could not be loaded.');
  });

  it('Add as a list creates the list, adds the verses into it without switching scope, and reloads', async () => {
    host.handlers.previewVerses = previewStub;
    host.handlers.createList = (r) => ({ ok: true, data: { lists: [{ id: 5, name: r.name, passageCount: 0, verseCount: 0 }] } });
    host.handlers.addPassage = () => ({ ok: true, data: { passage: { id: 1 }, existed: false } });
    const root = mount(plan(), set.key);
    const add = root.querySelector<HTMLButtonElement>('.sm-starter-add')!;
    expect(text(add)).toBe('Add as a list');
    add.click();
    await settle();
    await settle();
    expect(host.requests.find((r) => r.type === 'createList')).toMatchObject({ name: set.name });
    const adds = host.requests.filter((r) => r.type === 'addPassage');
    expect(adds.map((r: any) => r.reference)).toEqual(set.references);
    expect(adds.every((r: any) => r.collectionId === 5)).toBe(true);
    expect(host.requests.some((r) => r.type === 'setScope')).toBe(false);
    expect(host.reloads).toBe(1);
    expect(host.announcements).toEqual([`Created ${set.name} with ${set.references.length} verses.`]);
    expect(rowOf(root, set.key).querySelector('.sm-starter-tag')?.textContent).toBe('Added');
    expect(text(add)).toBe('Add missing verses');
  });

  it('an existing list reads Add missing verses and reuses that list', async () => {
    host.handlers.previewVerses = previewStub;
    host.handlers.addPassage = () => ({ ok: true, data: { passage: { id: 1 }, existed: true } });
    const root = mount(plan([{ id: 1, name: 'Default', passageCount: 0, verseCount: 0 }, { id: 9, name: set.name, passageCount: 2, verseCount: 2 }]), set.key);
    const add = root.querySelector<HTMLButtonElement>('.sm-starter-add')!;
    expect(text(add)).toBe('Add missing verses');
    add.click();
    await settle();
    await settle();
    expect(host.requests.some((r) => r.type === 'createList')).toBe(false);
    expect(host.requests.filter((r) => r.type === 'addPassage').every((r: any) => r.collectionId === 9)).toBe(true);
    expect(host.announcements).toEqual([`${set.name} is up to date.`]);
  });

  it('shows the error when the list cannot be created, and the failed references after a partial add', async () => {
    host.handlers.previewVerses = previewStub;
    host.handlers.createList = () => ({ ok: false, error: 'Disk full' });
    const root = mount(plan(), set.key);
    root.querySelector<HTMLButtonElement>('.sm-starter-add')!.click();
    await settle();
    expect(text(root.querySelector('.sm-starter-status [role="alert"]')!)).toBe('Disk full');
    expect(host.reloads).toBe(0);

    host.handlers.createList = (r) => ({ ok: true, data: { lists: [{ id: 5, name: r.name, passageCount: 0, verseCount: 0 }] } });
    host.handlers.addPassage = (r) => (r.reference === 'Romans 3:10' ? { ok: false, error: 'Nope' } : { ok: true, data: { passage: { id: 1 }, existed: false } });
    root.querySelector<HTMLButtonElement>('.sm-starter-add')!.click();
    await settle();
    await settle();
    expect(text(root.querySelector('.sm-starter-status')!)).toBe('Romans 3:10: Nope');
    expect(host.announcements.at(-1)).toBe(`${set.name}: 5 verses added, 1 reference failed.`);
    // The reload redraws the screen; the failure is still shown there.
    const redrawn = mount(plan([{ id: 5, name: set.name, passageCount: 5, verseCount: 5 }]), set.key);
    expect(text(redrawn.querySelector('.sm-starter-status')!)).toBe('Romans 3:10: Nope');
  });
});

describe('starter browser: add to existing list', () => {
  const set = SUGGESTED_LISTS.find((s) => s.key === 'romans-road')!;
  const lists: ListSummary[] = [
    { id: 1, name: 'Default', passageCount: 0, verseCount: 0 },
    { id: 7, name: 'Gospels', passageCount: 2, verseCount: 2 },
  ];
  afterEach(() => {
    document.querySelectorAll('.sm-modal-backdrop').forEach((n) => n.remove());
  });
  const picks = () => [...document.querySelectorAll<HTMLButtonElement>('.sm-starter-pick')];

  it('is not offered without lists', () => {
    host.handlers.previewVerses = previewStub;
    const root = mount(plan([]), set.key);
    expect(root.querySelector('.sm-starter-add-to')).toBeNull();
    expect(root.querySelector('.sm-starter-add')).not.toBeNull();
  });

  it('opens a dialog of the lists; picking one adds the set there, skips what it has, and summarises', async () => {
    host.handlers.previewVerses = previewStub;
    const there = new Set(set.references.slice(0, 2));
    host.handlers.addPassage = (r) => ({ ok: true, data: { passage: { id: 1 }, ...(there.has(r.reference) ? { existed: true } : {}) } });
    const root = mount(plan(lists), set.key);
    const addTo = root.querySelector<HTMLButtonElement>('.sm-starter-add-to')!;
    expect(text(addTo)).toBe('Add to existing list');
    addTo.click();
    expect(picks().map(text)).toEqual(['Default', 'Gospels']);
    picks()[1]!.click();
    expect(document.querySelector('.sm-modal-backdrop')).toBeNull();
    await settle();
    await settle();
    const adds = host.requests.filter((r) => r.type === 'addPassage');
    expect(adds.map((r: any) => r.reference)).toEqual(set.references);
    expect(adds.every((r: any) => r.collectionId === 7)).toBe(true);
    expect(host.requests.some((r) => r.type === 'createList')).toBe(false);
    const added = set.references.length - 2;
    expect(host.announcements).toEqual([`Added ${added} verses to Gospels; 2 were already there.`]);
    expect(host.reloads).toBe(1);
    // Adding to another list does not mark the set itself as added.
    expect(rowOf(root, set.key).querySelector('.sm-starter-tag')).toBeNull();
  });

  it('says so when the list already has every verse, without reloading', async () => {
    host.handlers.previewVerses = previewStub;
    host.handlers.addPassage = () => ({ ok: true, data: { passage: { id: 1 }, existed: true } });
    const root = mount(plan(lists), set.key);
    root.querySelector<HTMLButtonElement>('.sm-starter-add-to')!.click();
    picks()[1]!.click();
    await settle();
    await settle();
    expect(host.announcements).toEqual(['Gospels already has all of these verses.']);
    expect(host.reloads).toBe(0);
  });

  it('shows failed references and counts them in the summary', async () => {
    host.handlers.previewVerses = previewStub;
    host.handlers.addPassage = (r) => (r.reference === 'Romans 3:10' ? { ok: false, error: 'Nope' } : { ok: true, data: { passage: { id: 1 } } });
    const root = mount(plan(lists), set.key);
    root.querySelector<HTMLButtonElement>('.sm-starter-add-to')!.click();
    picks()[0]!.click();
    await settle();
    await settle();
    expect(text(root.querySelector('.sm-starter-status')!)).toBe('Romans 3:10: Nope');
    expect(host.announcements).toEqual([`Added ${set.references.length - 1} verses to Default. 1 reference failed.`]);
  });

  it('Cancel closes the dialog without adding', () => {
    host.handlers.previewVerses = previewStub;
    const root = mount(plan(lists), set.key);
    root.querySelector<HTMLButtonElement>('.sm-starter-add-to')!.click();
    [...document.querySelectorAll<HTMLButtonElement>('.sm-modal-backdrop button')].find((b) => text(b) === 'Cancel')!.click();
    expect(document.querySelector('.sm-modal-backdrop')).toBeNull();
    expect(host.requests.some((r) => r.type === 'addPassage')).toBe(false);
  });
});
