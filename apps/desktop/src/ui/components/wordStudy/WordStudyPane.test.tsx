import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WordStudyOverview } from '@bible/core/browser';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { enT } from '../../testing/enCatalog';

const api = vi.hoisted(() => ({
  resolve: vi.fn(), getOverview: vi.fn(), getOccurrences: vi.fn(),
  listGroups: vi.fn(), saveGroup: vi.fn(), deleteGroup: vi.fn(),
}));
vi.mock('../../../api/wordStudyApi', () => ({ wordStudyApi: api }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('../../stores/crossStoreBridge', async (orig) => ({
  ...(await orig<typeof import('../../stores/crossStoreBridge')>()),
  navigateToVerseInPrimary: navigate,
}));
const searchStrongs = vi.hoisted(() => vi.fn());
vi.mock('../../stores/useSearchStore', () => ({
  useSearchStore: Object.assign(() => undefined, { getState: () => ({ searchStrongsNumber: searchStrongs }) }),
}));
const openInDictionary = vi.hoisted(() => vi.fn());
vi.mock('../bible/openStrongsInDictionary', () => ({ openStrongsInDictionary: openInDictionary }));

import WordStudyPane from './WordStudyPane';
import { useWordStudyStore } from '../../stores/useWordStudyStore';

function services(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: { t: (key: string, params?: Record<string, unknown>) => enT(key, params), currentLocale: 'en' as const, onDidChangeLocale: () => ({ dispose: vi.fn() }), resolve: (v: unknown) => String(v), loadCatalog: vi.fn(), setLocale: vi.fn() } as unknown as AppServices['i18n'],
  };
}
const renderPane = () => render(<ContextProvider services={services()}><WordStudyPane panelId="wordStudy_t" /></ContextProvider>);

const overview: WordStudyOverview = {
  subject: { kind: 'strongs', label: 'G25', strongs: 'G25', language: 'Greek' },
  entry: null,
  modules: [{ module: 'KJV', name: 'King James', strongsTagged: true }],
  module: 'KJV',
  totals: { occurrences: 142, verses: 130 },
  bookCounts: { 43: 44 }, forms: [], morphology: [], family: [], semanticRange: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useWordStudyStore.setState({ panels: new Map(), savedGroups: [] });
  api.listGroups.mockResolvedValue([{ id: 'g1', label: 'Mercy', terms: ['mercy'] }]);
  api.getOverview.mockResolvedValue(overview);
  api.getOccurrences.mockResolvedValue({ total: 1, items: [{ verseId: 43003016, start: 0, end: 0, form: 'loved', text: 'For God so loved the world' }] });
  api.resolve.mockResolvedValue([]);
});

describe('WordStudyPane', () => {
  it('shows the prompt and the saved groups when empty', async () => {
    renderPane();
    expect(screen.getByTestId('word-study-empty')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Mercy' })).toBeTruthy();
  });

  it('studies a Strong\'s number and lists its occurrences with localized references', async () => {
    const user = userEvent.setup();
    renderPane();
    await user.type(screen.getByRole('textbox'), 'G25');
    await user.click(screen.getByRole('button', { name: 'Study' }));

    expect(await screen.findByText('142 occurrences in 130 verses')).toBeTruthy();
    expect(api.getOverview.mock.calls[0][0]).toEqual({ kind: 'strongs', strongs: 'G25' });
    expect(await screen.findByText(/John 3:16/)).toBeTruthy();
  });

  it('navigates the Bible pane when an occurrence is clicked', async () => {
    const user = userEvent.setup();
    renderPane();
    await user.type(screen.getByRole('textbox'), 'G25');
    await user.click(screen.getByRole('button', { name: 'Study' }));
    const ref = await screen.findByText(/John 3:16/);
    await user.click(ref.closest('button') ?? ref);
    expect(navigate).toHaveBeenCalledWith(43003016);
  });

  it('offers Strong\'s actions only for a Strong\'s subject', async () => {
    const user = userEvent.setup();
    renderPane();
    await user.type(screen.getByRole('textbox'), 'G25');
    await user.click(screen.getByRole('button', { name: 'Study' }));
    await user.click(await screen.findByRole('button', { name: 'Search all' }));
    expect(searchStrongs).toHaveBeenCalledWith('G25');
    await user.click(screen.getByRole('button', { name: 'Open in dictionary' }));
    expect(openInDictionary).toHaveBeenCalledWith('G25');
  });

  it('studies a comma list as a word group and hides Strong\'s actions', async () => {
    api.getOverview.mockResolvedValue({ ...overview, subject: { kind: 'group', label: 'love' }, modules: [] });
    const user = userEvent.setup();
    renderPane();
    await user.type(screen.getByRole('textbox'), 'love, loved, lov*');
    await user.click(screen.getByRole('button', { name: 'Study' }));
    await waitFor(() => expect(api.getOverview).toHaveBeenCalled());
    expect(api.getOverview.mock.calls[0][0].kind).toBe('group');
    expect(api.getOverview.mock.calls[0][0].group.terms).toEqual(['love', 'loved', 'lov*']);
    expect(api.resolve).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Search all' })).toBeNull();
  });

  it('shows a pick list when several entries match', async () => {
    api.resolve.mockResolvedValue([
      { strongs: 'G25', language: 'Greek', gloss: 'to love' },
      { strongs: 'G26', language: 'Greek', gloss: 'love' },
    ]);
    const user = userEvent.setup();
    renderPane();
    await user.type(screen.getByRole('textbox'), 'love');
    await user.click(screen.getByRole('button', { name: 'Study' }));
    expect(await screen.findByText('Did you mean')).toBeTruthy();
    await user.click(screen.getByText('to love').closest('button')!);
    await waitFor(() => expect(api.getOverview.mock.calls[0][0]).toEqual({ kind: 'strongs', strongs: 'G25' }));
  });

  it('reloads a restored subject on mount', async () => {
    useWordStudyStore.getState().restoreFromSession(
      { wordStudy_t: { subject: { kind: 'strongs', strongs: 'G25' }, options: {}, filters: {} } }, ['wordStudy_t'],
    );
    renderPane();
    expect(await screen.findByText('142 occurrences in 130 verses')).toBeTruthy();
  });

  it('goes back through the trail', async () => {
    const user = userEvent.setup();
    renderPane();
    await user.type(screen.getByRole('textbox'), 'G25');
    await user.click(screen.getByRole('button', { name: 'Study' }));
    await screen.findByText('142 occurrences in 130 verses');
    expect((screen.getByTestId('word-study-back') as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'G26');
    await user.click(screen.getByRole('button', { name: 'Study' }));
    await waitFor(() => expect((screen.getByTestId('word-study-back') as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByTestId('word-study-back'));
    await waitFor(() => expect(api.getOverview.mock.calls.at(-1)![0]).toEqual({ kind: 'strongs', strongs: 'G25' }));
  });
});
