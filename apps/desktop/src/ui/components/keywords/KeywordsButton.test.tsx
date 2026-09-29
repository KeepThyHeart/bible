/**
 * Keywords toolbar control (task 0065): toggle + count badge, legend popover wiring (rows, stepping, suggestions),
 * editor and manage-sets dialogs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryKeywordSetStore } from '@bible/core/browser';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}:${JSON.stringify(p)}` : key), locale: 'en', i18n: {} }),
}));
vi.mock('../../stores/helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));
vi.mock('../../services/keywordSetsAPI', () => ({ keywordSetsAPI: {} }));
vi.mock('../../stores/useKeywordMarkStore', async () => {
  const actual = await vi.importActual<typeof import('../../stores/useKeywordMarkStore')>('../../stores/useKeywordMarkStore');
  return {
    ...actual,
    useKeywordMarkStore: actual.createKeywordMarkStore({
      store: new MemoryKeywordSetStore(),
      fetchInterlinear: async () => ({}),
    }),
  };
});

import KeywordsButton from './KeywordsButton';
import { useKeywordMarkStore } from '../../stores/useKeywordMarkStore';

const V1 = 43003016;
const verses = [
  { verse_id: V1, text_html: 'For God so loved the world' },
  { verse_id: V1 + 1, text_html: 'God sent his Son, for God loved' },
];

function sync(tabId = 'tab-1') {
  useKeywordMarkStore.getState().syncChapter({
    tabId, moduleId: 1, abbreviation: 'KJV', language: 'en', bookNumber: 43, chapter: 3, verses,
  });
}

beforeEach(() => {
  useKeywordMarkStore.setState({ tabs: {}, chapters: {} });
  sync();
});

describe('KeywordsButton', () => {
  it('is an off toggle by default and turns marks on when clicked', () => {
    render(<KeywordsButton tabId="tab-1" />);
    const toggle = screen.getByTestId('keywords-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('keywords-count')).toBeNull();
    fireEvent.click(toggle);
    expect(useKeywordMarkStore.getState().getTabState('tab-1').enabled).toBe(true);
    expect(screen.getByTestId('keywords-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the count of visible marks in a badge', () => {
    useKeywordMarkStore.getState().setTabEnabled('tab-1', true);
    render(<KeywordsButton tabId="tab-1" />);
    const total = useKeywordMarkStore.getState().getLegendRows('tab-1').reduce((n, r) => n + r.hits, 0);
    expect(screen.getByTestId('keywords-count')).toHaveTextContent(String(total));
    expect(total).toBeGreaterThan(0);
  });

  it('opens the legend popover from the chevron and lists the marks', () => {
    useKeywordMarkStore.getState().setTabEnabled('tab-1', true);
    render(<KeywordsButton tabId="tab-1" />);
    expect(screen.queryByTestId('keywords-popover')).toBeNull();
    fireEvent.click(screen.getByTestId('keywords-options'));
    const pop = screen.getByTestId('keywords-popover');
    expect(within(pop).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(within(pop).getByTestId('keywords-color-safe')).toBeChecked();
  });

  it('toggling a row hides that mark for the tab', () => {
    useKeywordMarkStore.getState().setTabEnabled('tab-1', true);
    render(<KeywordsButton tabId="tab-1" />);
    fireEvent.click(screen.getByTestId('keywords-options'));
    const row = useKeywordMarkStore.getState().getLegendRows('tab-1')[0];
    fireEvent.click(screen.getByRole('button', { name: `keywords.legend.hide:${JSON.stringify({ label: row.mark.label })}` }));
    expect(useKeywordMarkStore.getState().getTabState('tab-1').hiddenMarkIds).toContain(row.markId);
  });

  it('steps through occurrences, scrolls to the word and announces it', () => {
    useKeywordMarkStore.getState().setTabEnabled('tab-1', true);
    const pane = document.createElement('div');
    pane.setAttribute('data-testid', 'bible-pane');
    document.body.appendChild(pane);
    const row = useKeywordMarkStore.getState().getLegendRows('tab-1').find((r) => r.hits > 0)!;
    const occ = useKeywordMarkStore.getState().getOccurrences('tab-1', row.markId);
    pane.innerHTML = occ.map((o) =>
      `<div data-verse-id="${o.verseId}"><span class="word" data-word-index="${o.start}">w</span></div>`).join('');
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;

    render(<KeywordsButton tabId="tab-1" />, { container: pane.appendChild(document.createElement('div')) });
    fireEvent.click(screen.getByTestId('keywords-options'));
    fireEvent.click(screen.getByRole('button', { name: `keywords.legend.next:${JSON.stringify({ label: row.mark.label })}` }));

    expect(scroll).toHaveBeenCalled();
    expect(document.querySelector('.keyword-step-flash')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      `keywords.legend.announce:${JSON.stringify({ label: row.mark.label, verse: occ[0].verseId % 1000, index: 1, total: occ.length })}`,
    );
    pane.remove();
  });

  it('accepting a suggestion adds a mark', async () => {
    useKeywordMarkStore.getState().setTabEnabled('tab-1', true);
    render(<KeywordsButton tabId="tab-1" />);
    fireEvent.click(screen.getByTestId('keywords-options'));
    const add = screen.getAllByRole('button', { name: /^keywords\.legend\.addSuggestion/ })[0];
    fireEvent.click(add);
    await waitFor(() => expect(useKeywordMarkStore.getState().sets.some((s) => !s.builtIn && s.marks.length > 0)).toBe(true));
  });

  it('opens the editor dialog from Add keyword and saves a mark', async () => {
    useKeywordMarkStore.getState().setTabEnabled('tab-1', true);
    render(<KeywordsButton tabId="tab-1" />);
    fireEvent.click(screen.getByTestId('keywords-options'));
    fireEvent.click(screen.getByRole('button', { name: 'keywords.legend.add' }));
    const dialog = await screen.findByTestId('keyword-editor-dialog');
    fireEvent.change(within(dialog).getByLabelText('keywords.editor.label'), { target: { value: 'World' } });
    fireEvent.change(within(dialog).getByLabelText('keywords.editor.forms'), { target: { value: 'world' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'keywords.editor.save' }));
    await waitFor(() => expect(screen.queryByTestId('keyword-editor-dialog')).toBeNull());
    expect(useKeywordMarkStore.getState().getLegendRows('tab-1').some((r) => r.mark.label === 'World')).toBe(true);
  });

  it('opens Manage sets listing the built-in sets read-only', () => {
    useKeywordMarkStore.getState().setTabEnabled('tab-1', true);
    render(<KeywordsButton tabId="tab-1" />);
    fireEvent.click(screen.getByTestId('keywords-options'));
    fireEvent.click(screen.getByRole('button', { name: 'keywords.legend.manageSets' }));
    const dialog = screen.getByTestId('keyword-sets-dialog');
    const builtin = within(dialog).getByTestId('keyword-set-builtin:connectives-en');
    expect(within(builtin).queryByRole('button', { name: 'keywords.sets.delete' })).toBeNull();
    expect(within(builtin).getByRole('button', { name: 'keywords.sets.duplicate' })).toBeInTheDocument();
  });
});
