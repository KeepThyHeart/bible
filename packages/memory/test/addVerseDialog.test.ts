/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListSummary, PanelReply, PanelRequest, PlanView } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import { WordMeasurer } from '../src/ui/measure';
import { setUiTranslator } from '../src/ui/i18n';
import { openAddVerseDialog, preselectList } from '../src/ui/addVerseDialog';
import type { VerseSelectorPort, VerseSelectorPortProps } from '../src/ui/verseSelectorPort';

const LISTS: ListSummary[] = [
  { id: 1, name: 'Default', passageCount: 0, verseCount: 0 },
  { id: 2, name: 'Romans', passageCount: 0, verseCount: 0 },
];
const PASSAGE = { id: 5, collectionId: 2, reference: 'John 3:16' };

function makeHost(over: { plan?: Partial<PlanView> | null; port?: VerseSelectorPort } = {}) {
  const requests: PanelRequest[] = [];
  const order: string[] = [];
  const refresh = vi.fn(async () => {
    order.push('refresh');
    return {} as PlanView;
  });
  const host = {
    requests,
    announcements: [] as string[],
    started: [] as number[],
    activeReference: 'John 3:16',
    measurer: new WordMeasurer(document),
    now: () => 0,
    request: async (r: PanelRequest): Promise<PanelReply<any>> => {
      requests.push(r);
      if (r.type === 'addPassageRange') return { ok: true, data: { passage: PASSAGE } };
      if (r.type === 'previewVerses') return { ok: true, data: { reference: 'John 3:16', verses: [{ verseId: 1, label: '3:16', words: ['For', 'God'], lines: null }] } };
      return { ok: true, data: {} };
    },
    go: () => {},
    reload: () => {},
    startSession: async (id: number) => {
      host.started.push(id);
    },
    startFlow: async () => true,
    openInBible: () => {},
    announce(m: string) {
      host.announcements.push(m);
    },
    data: over.plan === null ? undefined : ({ get: () => ({ collectionId: 1, ...over.plan }), refresh } as never),
    verseSelector: over.port,
  };
  return { host: host as unknown as PanelHost & typeof host, refresh, order };
}

function fakePort() {
  let props!: VerseSelectorPortProps;
  const dispose = vi.fn();
  const port: VerseSelectorPort = {
    mount: (_c, p) => {
      props = p;
      return { update: () => {}, dispose };
    },
  };
  return { port, props: () => props, dispose };
}

const btn = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('preselectList', () => {
  it('prefers the explicit list, then the last chosen, then the focus, then Default', () => {
    expect(preselectList(LISTS, 2, { lastAddListId: 1, focus: 1 } as PlanView)).toBe(2);
    expect(preselectList(LISTS, null, { lastAddListId: 2, focus: 1 } as PlanView)).toBe(2);
    expect(preselectList(LISTS, null, { lastAddListId: 9, focus: 2 } as PlanView)).toBe(2);
    expect(preselectList(LISTS, null, { lastAddListId: null, focus: 'all', collectionId: 99 } as PlanView)).toBe(1);
    expect(preselectList(LISTS, null, null)).toBe(1);
  });
});

describe('openAddVerseDialog with the selector port', () => {
  it('passes the locale and translated selector labels, keeping the placeholders', () => {
    setUiTranslator((key, fallback, params) => {
      let out = key.endsWith('.book') ? 'Libro' : fallback;
      for (const [k, val] of Object.entries(params ?? {})) out = out.replace(`{${k}}`, String(val));
      return out;
    }, 'es');
    try {
      const { port, props } = fakePort();
      const { host } = makeHost({ port });
      openAddVerseDialog(host, { lists: LISTS, onAdded: () => {} });
      expect(props().locale).toBe('es');
      expect(props().labels?.book).toBe('Libro');
      expect(props().labels?.endOfChapter).toContain('{chapter}');
      expect(props().labels?.more).toContain('{count}');
    } finally {
      setUiTranslator();
    }
  });

  it('seeds from the active reference and previews through previewVerses', async () => {
    const { port, props } = fakePort();
    const { host } = makeHost({ port });
    openAddVerseDialog(host, { lists: LISTS, onAdded: () => {} });
    expect(props().initialReference).toBe('John 3:16');
    const out = await props().lookup!({ verseId: 10, endVerseId: 12 }, new AbortController().signal);
    expect(out).toEqual([{ verseId: 1, text: 'For God' }]);
    expect(host.requests.at(-1)).toEqual({ type: 'previewVerses', startVerseId: 10, endVerseId: 12 });
  });

  it('adds to the preselected (last chosen) list, refreshes before onAdded, and announces', async () => {
    const { port, props } = fakePort();
    const { host, order } = makeHost({ port, plan: { lastAddListId: 2 } });
    const onAdded = vi.fn(() => order.push('onAdded'));
    openAddVerseDialog(host, { lists: LISTS, onAdded });
    expect((document.querySelector('#sm-add-dialog-list') as HTMLSelectElement).value).toBe('2');
    props().onChange({ verseId: 10, endVerseId: 12, ref: 'John 3:16-18' });
    btn('Add').click();
    await flush();
    expect(host.requests.find((r) => r.type === 'addPassageRange')).toEqual({ type: 'addPassageRange', startVerseId: 10, endVerseId: 12, collectionId: 2 });
    expect(order).toEqual(['refresh', 'onAdded']);
    expect(host.announcements).toEqual(['Added John 3:16 to Romans.']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('"Add and start" starts practice on the new verse; an explicit list wins', async () => {
    const { port, props } = fakePort();
    const { host } = makeHost({ port, plan: { lastAddListId: 2 } });
    openAddVerseDialog(host, { lists: LISTS, listId: 1, onAdded: () => {} });
    expect((document.querySelector('#sm-add-dialog-list') as HTMLSelectElement).value).toBe('1');
    props().onChange({ verseId: 10, ref: 'John 3:16' });
    btn('Add and start').click();
    await flush();
    expect(host.started).toEqual([5]);
  });

  it('creates a new list on the spot', async () => {
    const { port, props } = fakePort();
    const { host } = makeHost({ port });
    openAddVerseDialog(host, { lists: LISTS, onAdded: () => {} });
    const sel = document.querySelector('#sm-add-dialog-list') as HTMLSelectElement;
    sel.value = 'new';
    sel.dispatchEvent(new Event('change'));
    props().onChange({ verseId: 10, ref: 'John 3:16' });
    btn('Add').click();
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Give the new list a name.');
    (document.querySelector('#sm-add-dialog-name') as HTMLInputElement).value = 'Hope';
    btn('Add').click();
    await flush();
    expect(host.requests.find((r) => r.type === 'addPassageRange')).toEqual({ type: 'addPassageRange', startVerseId: 10, endVerseId: 10, newListName: 'Hope' });
  });

  it('Enter in the selector (onSubmit) adds, and closing disposes the selector', async () => {
    const { port, props, dispose } = fakePort();
    const { host } = makeHost({ port });
    openAddVerseDialog(host, { lists: LISTS, onAdded: () => {} });
    props().onSubmit!({ verseId: 10, ref: 'John 3:16' });
    await flush();
    expect(host.requests.some((r) => r.type === 'addPassageRange')).toBe(true);
    expect(dispose).toHaveBeenCalled();
  });
});

describe('openAddVerseDialog dialog behavior', () => {
  it('Escape closes the dialog even from a seeded, non-empty reference input (M1)', () => {
    const { port } = fakePort();
    const { host } = makeHost({ port });
    openAddVerseDialog(host, { lists: LISTS, onAdded: () => {} });
    const input = document.createElement('input');
    input.value = 'John 3:16';
    document.querySelector('.sm-add-dialog')!.appendChild(input);
    // mimic the picker: swallow Escape in the bubble phase
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Escape closes the suggestion list first when it is expanded (M1)', () => {
    const { port } = fakePort();
    const { host } = makeHost({ port });
    openAddVerseDialog(host, { lists: LISTS, onAdded: () => {} });
    const input = document.createElement('input');
    input.setAttribute('aria-expanded', 'true');
    input.addEventListener('keydown', (e) => e.stopPropagation()); // the picker closes its own list
    document.querySelector('.sm-add-dialog')!.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('shows the new-list name only when "New list..." is selected (M2)', () => {
    const { port } = fakePort();
    const { host } = makeHost({ port });
    openAddVerseDialog(host, { lists: LISTS, onAdded: () => {} });
    const field = (document.querySelector('#sm-add-dialog-name') as HTMLElement).parentElement as HTMLElement;
    expect(field.hidden).toBe(true);
    const sel = document.querySelector('#sm-add-dialog-list') as HTMLSelectElement;
    sel.value = 'new';
    sel.dispatchEvent(new Event('change'));
    expect(field.hidden).toBe(false);
    sel.value = '1';
    sel.dispatchEvent(new Event('change'));
    expect(field.hidden).toBe(true);
  });

  it('the empty error slot is :empty so CSS can collapse it (S1)', () => {
    const { port } = fakePort();
    const { host } = makeHost({ port });
    openAddVerseDialog(host, { lists: LISTS, onAdded: () => {} });
    expect(document.querySelector('.sm-error-slot')!.childNodes.length).toBe(0);
  });
});

describe('openAddVerseDialog without a port', () => {
  it('uses a typed field and addPassage', async () => {
    const { host } = makeHost();
    openAddVerseDialog(host, { lists: [LISTS[0]!], onAdded: () => {} });
    expect(document.querySelector('#sm-add-dialog-list')).toBeNull();
    const input = document.querySelector('#sm-add-dialog-reference') as HTMLInputElement;
    input.value = 'Romans 8:28';
    host.request = async (r: PanelRequest) => {
      host.requests.push(r);
      return { ok: true, data: { passage: PASSAGE } } as never;
    };
    btn('Add').click();
    await flush();
    expect(host.requests.at(-1)).toEqual({ type: 'addPassage', reference: 'Romans 8:28', collectionId: 1 });
  });
});

describe('trailing text after a verse number (C)', () => {
  const rejectJunk = (host: ReturnType<typeof makeHost>['host']) => {
    host.request = async (r: PanelRequest) => {
      host.requests.push(r);
      if (r.type === 'addPassage' && r.reference === 'Philippians 4:1a') {
        return { ok: false, error: '"Philippians 4:1a" is not a reference.' } as never;
      }
      return { ok: true, data: { passage: PASSAGE } } as never;
    };
  };

  it('the single add sends "Philippians 4:1a" whole and shows the error', async () => {
    const { host } = makeHost();
    rejectJunk(host);
    openAddVerseDialog(host, { lists: [LISTS[0]!], onAdded: () => {} });
    (document.querySelector('#sm-add-dialog-reference') as HTMLInputElement).value = 'Philippians 4:1a';
    btn('Add').click();
    await flush();
    expect(host.requests.at(-1)).toEqual({ type: 'addPassage', reference: 'Philippians 4:1a', collectionId: 1 });
    expect(document.querySelector('.sm-error-slot')!.textContent).toContain('Philippians 4:1a');
  });

  it('the bulk add lists "Philippians 4:1a" as its own reference and reports it as failed', async () => {
    const { host } = makeHost();
    rejectJunk(host);
    openAddVerseDialog(host, { lists: [LISTS[0]!], onAdded: () => {} });
    btn('Add several at once').click();
    (document.querySelector('#sm-batch-textarea') as HTMLTextAreaElement).value = 'John 3:16\nPhilippians 4:1a';
    btn('Find references').click();
    expect([...document.querySelectorAll('.sm-batch-list-item')].map((li) => li.textContent)).toEqual(['John 3:16', 'Philippians 4:1a']);
    btn('Add 2 verses').click();
    await flush();
    await flush();
    const refs = host.requests.filter((r) => r.type === 'addPassage').map((r: any) => r.reference);
    expect(refs).toEqual(['John 3:16', 'Philippians 4:1a']);
    expect(document.querySelector('.sm-error-slot')!.textContent).toContain('Philippians 4:1a: "Philippians 4:1a" is not a reference.');
  });
});

describe('fixed-size preview (B)', () => {
  it('gives the selector a placeholder for the empty preview box', () => {
    const { port } = fakePort();
    const { host } = makeHost({ port });
    openAddVerseDialog(host, { lists: LISTS, onAdded: () => {} });
    const field = document.querySelector('.sm-add-dialog__field') as HTMLElement;
    expect(field.style.getPropertyValue('--sm-preview-empty')).toBe('"The verse text appears here."');
  });
});
