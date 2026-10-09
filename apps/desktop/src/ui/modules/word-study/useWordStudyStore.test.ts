import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WordStudyOverview, WordOccurrenceItem } from '@bible/core/browser';

const api = vi.hoisted(() => ({
  resolve: vi.fn(),
  getOverview: vi.fn(),
  getOccurrences: vi.fn(),
  listGroups: vi.fn(),
  saveGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));
vi.mock('./wordStudyApi', () => ({ wordStudyApi: api }));

import {
  useWordStudyStore,
  classifyWordStudyQuery,
  WORD_STUDY_PAGE_SIZE,
} from './useWordStudyStore';
import { setResolveActiveBibleModule } from '../../stores/crossStoreBridge';
import { collectSessionData } from '../../stores/helpers/sessionRegistry';

const P = 'wordStudy_1';

function overview(label: string, extra: Partial<WordStudyOverview> = {}): WordStudyOverview {
  return {
    subject: { kind: 'strongs', label, strongs: label },
    entry: null, modules: [], module: 'KJV', totals: { occurrences: 250, verses: 240 },
    bookCounts: {}, forms: [], morphology: [], family: [], semanticRange: null, ...extra,
  };
}
const items = (from: number, n: number): WordOccurrenceItem[] =>
  Array.from({ length: n }, (_, i) => ({ verseId: 43003016 + from + i, start: 0, end: 0, form: 'love' }));

const flush = () => new Promise((r) => setTimeout(r, 0));
const ps = () => useWordStudyStore.getState().getPanelState(P);

beforeEach(() => {
  vi.clearAllMocks();
  useWordStudyStore.setState({ panels: new Map(), savedGroups: [] });
  setResolveActiveBibleModule(null);
  api.getOverview.mockImplementation(async (s: any) => overview(s.kind === 'strongs' ? s.strongs : s.group.label));
  api.getOccurrences.mockResolvedValue({ total: 0, items: [] });
  api.resolve.mockResolvedValue([]);
});

describe('classifyWordStudyQuery', () => {
  it('recognises Strong\'s numbers and normalises them', () => {
    expect(classifyWordStudyQuery('g25')).toEqual({ kind: 'strongs', strongs: 'G25' });
    expect(classifyWordStudyQuery(' H0430 ')).toEqual({ kind: 'strongs', strongs: 'H430' });
  });
  it('treats lists, wildcards and phrases as groups', () => {
    for (const q of ['love, loved', 'lov*', 'a;b', 'a|b', 'loving kindness']) {
      expect(classifyWordStudyQuery(q).kind).toBe('group');
    }
  });
  it('asks the lexicon about a single plain word', () => {
    expect(classifyWordStudyQuery('agapao').kind).toBe('lookup');
  });
});

describe('submitQuery', () => {
  it('studies a Strong\'s number without calling resolve', async () => {
    await useWordStudyStore.getState().submitQuery(P, 'G25');
    expect(api.resolve).not.toHaveBeenCalled();
    expect(ps().subject).toEqual({ kind: 'strongs', strongs: 'G25' });
    expect(ps().overview?.subject.label).toBe('G25');
  });

  it('opens the only candidate', async () => {
    api.resolve.mockResolvedValue([{ strongs: 'G26', language: 'Greek', gloss: 'love' }]);
    await useWordStudyStore.getState().submitQuery(P, 'agape');
    expect(ps().subject).toEqual({ kind: 'strongs', strongs: 'G26' });
  });

  it('lists several candidates instead of choosing', async () => {
    api.resolve.mockResolvedValue([
      { strongs: 'G25', language: 'Greek', gloss: 'love' },
      { strongs: 'G26', language: 'Greek', gloss: 'love' },
    ]);
    await useWordStudyStore.getState().submitQuery(P, 'love');
    expect(ps().candidates).toHaveLength(2);
    expect(ps().subject).toBeNull();
    expect(api.getOverview).not.toHaveBeenCalled();
    await useWordStudyStore.getState().pickCandidate(P, 'G26');
    expect(ps().candidates).toEqual([]);
    expect(ps().subject).toEqual({ kind: 'strongs', strongs: 'G26' });
  });

  it('falls back to a word group when nothing resolves', async () => {
    await useWordStudyStore.getState().submitQuery(P, 'zzyzx');
    expect(ps().subject?.kind).toBe('group');
    if (ps().subject?.kind === 'group') {
      expect((ps().subject as any).group.terms).toEqual(['zzyzx']);
    }
  });

  it('studies a comma list as a group without resolving', async () => {
    await useWordStudyStore.getState().submitQuery(P, 'love, loved, lov*');
    expect(api.resolve).not.toHaveBeenCalled();
    expect((ps().subject as any).group.terms).toEqual(['love', 'loved', 'lov*']);
  });
});

describe('trail', () => {
  it('goes back and forward and truncates on a new study', async () => {
    const s = () => useWordStudyStore.getState();
    await s().study(P, { kind: 'strongs', strongs: 'G1' });
    await s().study(P, { kind: 'strongs', strongs: 'G2' });
    await s().study(P, { kind: 'strongs', strongs: 'G3' });
    expect(ps().trail).toHaveLength(3);

    await s().goBack(P);
    expect(ps().subject).toEqual({ kind: 'strongs', strongs: 'G2' });
    await s().goBack(P);
    await s().goBack(P); // already at the start
    expect(ps().subject).toEqual({ kind: 'strongs', strongs: 'G1' });
    await s().goForward(P);
    expect(ps().subject).toEqual({ kind: 'strongs', strongs: 'G2' });

    await s().study(P, { kind: 'strongs', strongs: 'G9' });
    expect(ps().trail.map((t: any) => t.strongs)).toEqual(['G1', 'G2', 'G9']);
    await s().goForward(P); // nothing ahead
    expect(ps().subject).toEqual({ kind: 'strongs', strongs: 'G9' });
  });

  it('does not push the same subject twice', async () => {
    await useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G1' });
    await useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G1' });
    expect(ps().trail).toHaveLength(1);
  });
});

describe('occurrences paging', () => {
  it('fetches a page, then appends on load more', async () => {
    api.getOccurrences
      .mockResolvedValueOnce({ total: 150, items: items(0, 100) })
      .mockResolvedValueOnce({ total: 150, items: items(100, 50) });
    await useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G25' });
    expect(api.getOccurrences.mock.calls[0][1]).toMatchObject({ module: 'KJV', offset: 0, limit: WORD_STUDY_PAGE_SIZE });
    expect(ps().occurrences?.items).toHaveLength(100);

    await useWordStudyStore.getState().loadMore(P);
    expect(api.getOccurrences.mock.calls[1][1]).toMatchObject({ offset: 100 });
    expect(ps().occurrences?.items).toHaveLength(150);

    await useWordStudyStore.getState().loadMore(P); // complete: no more requests
    expect(api.getOccurrences).toHaveBeenCalledTimes(2);
  });

  it('refetches from the start when a filter changes', async () => {
    api.getOccurrences.mockResolvedValue({ total: 5, items: items(0, 5) });
    await useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G25' });
    await useWordStudyStore.getState().setFilters(P, { book: 43, form: 'love' });
    expect(api.getOverview).toHaveBeenCalledTimes(1);
    expect(api.getOccurrences.mock.calls[1][1]).toMatchObject({ book: 43, form: 'love', offset: 0 });
    expect(ps().filters).toEqual({ book: 43, form: 'love' });
  });

  it('skips occurrences when no module is available', async () => {
    api.getOverview.mockResolvedValue(overview('G1', { module: undefined, notice: 'no-module' }));
    await useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G1' });
    expect(api.getOccurrences).not.toHaveBeenCalled();
    expect(ps().occurrences).toBeNull();
  });
});

describe('default module', () => {
  it('uses the active Bible pane\'s translation, and lets the service pick when it does not suit', async () => {
    setResolveActiveBibleModule(() => 'NIV');
    api.getOverview.mockImplementation(async (_s: any, o: any) =>
      o?.module === 'NIV' ? overview('G1', { notice: 'not-tagged' }) : overview('G1'));
    await useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G1' });
    expect(api.getOverview.mock.calls[0][1]).toMatchObject({ module: 'NIV' });
    expect(api.getOverview.mock.calls[1][1].module).toBeUndefined();
    expect(ps().overview?.notice).toBeUndefined();
  });

  it('does not override an explicit module choice', async () => {
    setResolveActiveBibleModule(() => 'NIV');
    await useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G1' });
    await useWordStudyStore.getState().setModule(P, 'ESV');
    expect(api.getOverview.mock.calls.at(-1)![1]).toMatchObject({ module: 'ESV' });
  });
});

describe('errors', () => {
  it('records an overview failure', async () => {
    api.getOverview.mockRejectedValue(new Error('boom'));
    await useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G1' });
    expect(ps().error).toBe('boom');
    expect(ps().loading).toBe(false);
  });

  it('drops a stale overview', async () => {
    let releaseFirst!: (o: WordStudyOverview) => void;
    api.getOverview
      .mockImplementationOnce(() => new Promise((r) => { releaseFirst = r; }))
      .mockResolvedValueOnce(overview('G2'));
    const first = useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G1' });
    await flush();
    await useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G2' });
    releaseFirst(overview('G1'));
    await first;
    expect(ps().overview?.subject.label).toBe('G2');
  });
});

describe('groups', () => {
  it('saves a group, refreshes the list and studies it', async () => {
    const saved = { id: 'g1', label: 'love', terms: ['love'] };
    api.saveGroup.mockResolvedValue(saved);
    api.listGroups.mockResolvedValue([saved]);
    useWordStudyStore.getState().setEditingGroup(P, { id: '', label: 'love', terms: ['love'] });
    await useWordStudyStore.getState().saveGroup(P, { id: '', label: 'love', terms: ['love'] });
    expect(api.saveGroup.mock.calls[0][0].id).toBeUndefined();
    expect(useWordStudyStore.getState().savedGroups).toEqual([saved]);
    expect(ps().editingGroup).toBeNull();
    expect(ps().subject).toEqual({ kind: 'group', group: saved });
  });

  it('deletes a group and refreshes the list', async () => {
    api.deleteGroup.mockResolvedValue(true);
    api.listGroups.mockResolvedValue([]);
    await useWordStudyStore.getState().deleteGroup(P, 'g1');
    expect(api.deleteGroup).toHaveBeenCalledWith('g1');
    expect(useWordStudyStore.getState().savedGroups).toEqual([]);
  });
});

describe('session', () => {
  it('serialises only subject, options and filters, and restores them', async () => {
    api.getOccurrences.mockResolvedValue({ total: 1, items: items(0, 1) });
    await useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G25' }, { module: 'KJV', renderingMode: 'phrase' });
    await useWordStudyStore.getState().setFilters(P, { book: 43 });
    useWordStudyStore.getState().initPanel('wordStudy_empty'); // no subject: not persisted

    const data = collectSessionData().wordStudy as { wordStudyPanels: Record<string, unknown> };
    expect(data.wordStudyPanels).toEqual({
      [P]: { subject: { kind: 'strongs', strongs: 'G25' }, options: { module: 'KJV', renderingMode: 'phrase' }, filters: { book: 43 } },
    });
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);

    useWordStudyStore.setState({ panels: new Map() });
    useWordStudyStore.getState().restoreFromSession(data.wordStudyPanels, [P, 'wordStudy_other']);
    expect(ps().subject).toEqual({ kind: 'strongs', strongs: 'G25' });
    expect(ps().options).toEqual({ module: 'KJV', renderingMode: 'phrase' });
    expect(ps().filters).toEqual({ book: 43 });
    expect(ps().overview).toBeNull();
    expect(ps().occurrences).toBeNull();
    expect(ps().query).toBe('G25');

    await useWordStudyStore.getState().ensureLoaded(P);
    expect(ps().overview).not.toBeNull();
    expect(api.getOccurrences.mock.calls.at(-1)![1]).toMatchObject({ book: 43 }); // filters survive the reload
  });

  it('ignores malformed saved entries', () => {
    useWordStudyStore.getState().restoreFromSession(
      { [P]: { subject: { kind: 'group', group: { terms: [] } } }, x: 1 }, [P, 'x'],
    );
    expect(useWordStudyStore.getState().panels.has(P)).toBe(false);
  });
});

describe('lifecycle', () => {
  it('detach keeps the study but drops fetched data; destroy removes the pane', async () => {
    await useWordStudyStore.getState().study(P, { kind: 'strongs', strongs: 'G25' });
    useWordStudyStore.getState().detachPanel(P);
    expect(ps().subject).toEqual({ kind: 'strongs', strongs: 'G25' });
    expect(ps().overview).toBeNull();
    useWordStudyStore.getState().destroyPanel(P);
    expect(useWordStudyStore.getState().panels.has(P)).toBe(false);
  });
});
