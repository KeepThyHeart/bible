import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string; module?: string }) =>
    (key === 'wordStudy.summarySource' ? `translated ${opts?.module}` : opts?.defaultValue ?? key), i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

const navigateToPreview = vi.fn();
vi.mock('../../stores/bibleStore', () => ({
  bibleStore: { getActiveModule: () => 'KJV', navigateToPreview: (...a: unknown[]) => navigateToPreview(...a) },
}));
const performSearch = vi.fn();
vi.mock('../../stores/searchStore', () => ({ searchStore: { performSearch: (...a: unknown[]) => performSearch(...a) } }));
vi.mock('../../stores/moduleStore', () => ({ moduleStore: { getBookName: (n: number) => (n === 43 ? 'John' : `Book ${n}`) } }));

import { WordStudyPane } from './WordStudyPane';
import { wordStudyStore } from './wordStudyStore';
import { WordStudyOfflineError } from './WordStudyProvider';
import type { IWordStudyProvider, WordStudyOverview } from '@bible/core/browser';

const overview: WordStudyOverview = {
  subject: { kind: 'strongs', label: 'G25', strongs: 'G25', language: 'Greek' },
  entry: null, modules: [{ module: 'KJV', name: 'KJV', strongsTagged: true }], module: 'KJV',
  totals: { occurrences: 1, verses: 1 }, bookCounts: { 43: 1 }, forms: [], morphology: [], family: [], semanticRange: null,
};

let provider: { resolve: ReturnType<typeof vi.fn>; getOverview: ReturnType<typeof vi.fn>; getOccurrences: ReturnType<typeof vi.fn> };

beforeEach(() => {
  navigateToPreview.mockClear(); performSearch.mockClear();
  provider = {
    resolve: vi.fn(async () => []),
    getOverview: vi.fn(async () => overview),
    getOccurrences: vi.fn(async () => ({ total: 1, items: [{ verseId: 43003016, start: 0, end: 0, form: 'loved', text: 'For God so loved the world' }] })),
  };
  wordStudyStore.init(provider as unknown as IWordStudyProvider);
  wordStudyStore.reset();
});

describe('WordStudyPane', () => {
  it('offers no saving: no saved-groups list, New group or Save', () => {
    render(<WordStudyPane />);
    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
    expect(screen.queryByText('Word groups')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows the lookup prompt before anything is studied', () => {
    render(<WordStudyPane />);
    expect(screen.getByText('wordStudy.prompt')).toBeTruthy();
  });

  it('studies a Strong\'s number and navigates to an occurrence', async () => {
    const onNavigate = vi.fn();
    render(<WordStudyPane onNavigate={onNavigate} />);
    await wordStudyStore.openStrongs('G25');
    const ref = await screen.findByText('John 3:16');
    fireEvent.click(ref);
    expect(navigateToPreview).toHaveBeenCalledWith(43, 3, 16);
    expect(onNavigate).toHaveBeenCalled();
  });

  it('search all uses the existing Strong\'s search, dictionary uses the layout route', async () => {
    const onOpenStrongsEntry = vi.fn();
    render(<WordStudyPane onOpenStrongsEntry={onOpenStrongsEntry} />);
    await wordStudyStore.openStrongs('G25');
    fireEvent.click(await screen.findByText('Search all'));
    expect(performSearch).toHaveBeenCalledWith('G25');
    fireEvent.click(screen.getByText('Open in dictionary'));
    expect(onOpenStrongsEntry).toHaveBeenCalledWith('G25', 'wordStudy');
  });

  it('submitting a group query studies a word group', async () => {
    render(<WordStudyPane />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'love, lov*' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(wordStudyStore.subject?.kind).toBe('group'));
  });

  it('shows the online-only state when offline', async () => {
    provider.getOverview.mockRejectedValue(new WordStudyOfflineError());
    render(<WordStudyPane />);
    await wordStudyStore.openStrongs('G25');
    expect(await screen.findByTestId('word-study-offline')).toBeTruthy();
    expect(screen.getByText('wordStudy.offline')).toBeTruthy();
  });

  it('back button follows the trail and close is offered only with onClose', async () => {
    const onClose = vi.fn();
    render(<WordStudyPane onClose={onClose} />);
    await wordStudyStore.openStrongs('G25');
    await wordStudyStore.openStrongs('G26');
    fireEvent.click(await screen.findByLabelText('wordStudy.back'));
    await waitFor(() => expect(wordStudyStore.subject).toEqual({ kind: 'strongs', strongs: 'G25' }));
    fireEvent.click(screen.getByLabelText('wordStudy.close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Back and Forward put the studied word back in the lookup box', async () => {
    render(<WordStudyPane />);
    await wordStudyStore.openStrongs('G25');
    await wordStudyStore.openStrongs('G26');
    wordStudyStore.setQuery('G26');
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.click(await screen.findByLabelText('wordStudy.back'));
    await waitFor(() => expect(input.value).toBe('G25'));
    fireEvent.click(screen.getByLabelText('wordStudy.forward'));
    await waitFor(() => expect(input.value).toBe('G26'));
  });

  it('keeps focus on the other arrow when Back disables itself, and on Back when Forward does', async () => {
    render(<WordStudyPane />);
    await wordStudyStore.openStrongs('G25');
    await wordStudyStore.openStrongs('G26');
    const back = await screen.findByLabelText('wordStudy.back') as HTMLButtonElement;
    back.focus();
    fireEvent.click(back);
    await waitFor(() => expect(back.disabled).toBe(true));
    const forward = screen.getByLabelText('wordStudy.forward') as HTMLButtonElement;
    await waitFor(() => expect(document.activeElement).toBe(forward));
    fireEvent.click(forward);
    await waitFor(() => expect(forward.disabled).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(back));
  });

  it('shows the opened subject in the lookup box, replacing the previous query (interlinear word)', async () => {
    render(<WordStudyPane />);
    await wordStudyStore.submit('H7225');
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('H7225'));
    await wordStudyStore.openStrongs('H5175');
    await waitFor(() => expect(input.value).toBe('H5175'));
  });

  it('Load more moves focus to the first newly added row', async () => {
    const row = (n: number) => ({ verseId: 43003016 + n, start: 0, end: 0, form: 'loved', text: `Verse ${n}` });
    provider.getOccurrences.mockImplementation(async (_s: unknown, q: { offset?: number }) =>
      (q.offset ?? 0) === 0 ? { total: 2, items: [row(0)] } : { total: 2, items: [row(1)] });
    const { container } = render(<WordStudyPane />);
    await wordStudyStore.openStrongs('G25');
    const more = await waitFor(() => {
      const b = container.querySelector<HTMLButtonElement>('.kth-ws-occurrences__more');
      expect(b).not.toBeNull();
      return b!;
    });
    more.focus();
    fireEvent.click(more);
    await waitFor(() => expect(container.querySelectorAll('.kth-ws-occ').length).toBe(2));
    await waitFor(() => expect(document.activeElement).toBe(container.querySelectorAll('.kth-ws-occ')[1]));
    expect(container.querySelector('.kth-ws-occurrences__more')).toBeNull();
  });

  it('translates the summary line built in English by the data service', async () => {
    provider.getOverview.mockResolvedValue({
      ...overview,
      semanticRange: { sourceLabel: "Summary from Strong's and KJV usage", senses: [{ label: 'love', source: 'strongs' }] },
    });
    render(<WordStudyPane />);
    await wordStudyStore.openStrongs('G25');
    expect(await screen.findByText('translated KJV')).toBeTruthy();
  });
});
