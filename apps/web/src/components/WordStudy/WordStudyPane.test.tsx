import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key, i18n: { language: 'en' } }),
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
import { wordStudyStore } from '../../stores/wordStudyStore';
import { WordStudyOfflineError } from '../../providers/WordStudyProvider';
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
    expect(screen.queryByText('wordStudy.newGroup')).toBeNull();
    expect(screen.queryByText('wordStudy.groupsTitle')).toBeNull();
    expect(screen.queryByText('wordStudy.save')).toBeNull();
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
    expect(onOpenStrongsEntry).toHaveBeenCalledWith('G25');
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
});
