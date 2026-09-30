/**
 * Tests for the Keywords toolbar button: pressed state and badge, the legend
 * panel and stepping (scroll, flash, announcement), and that web offers no custom-set
 * controls (add, edit, manage sets, suggestions). The keyword store is the real singleton;
 * the Bible and module stores are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key),
    i18n: { language: 'en' },
  }),
}));

const verse = (n: number, html: string) => ({
  verse_id: 43003000 + n, book_number: 43, chapter: 3, verse: n, text: html, text_html: html,
  is_paragraph_start: false, words_of_christ: false,
});
const VERSES = [verse(1, 'For God so loved the world'), verse(2, 'therefore we believe, therefore we speak'), verse(3, 'but the world knew him not')];

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({ id: 't', moduleAbbr: 'KJV', book: 43, chapter: 3, verses: VERSES }),
    subscribe: () => () => {},
  },
}));
vi.mock('../../stores/moduleStore', () => ({
  moduleStore: { getBibleModules: () => [{ abbreviation: 'KJV', module_id: 1, language_code: 'en' }] },
}));

import { KeywordMarksButton } from './KeywordMarksButton';
import { keywordMarkStore } from '../../stores/keywordMarkStore';

function paint() {
  keywordMarkStore.getChapterMarks('bible', { chapterKey: 'KJV:43:3', moduleId: 1, language: 'en', verses: VERSES as never });
  keywordMarkStore.marksComputed('bible');
}

describe('KeywordMarksButton', () => {
  beforeEach(() => {
    localStorage.clear();
    keywordMarkStore.togglePane('bible', false);
    for (const id of keywordMarkStore.getPaneState('bible').hiddenMarkIds) keywordMarkStore.toggleMark('bible', id);
  });

  afterEach(() => { document.body.innerHTML = ''; });

  it('renders an unpressed toggle with no badge while marks are off', () => {
    render(<KeywordMarksButton />);
    const btn = screen.getByTestId('keyword-marks-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('keyword-marks-badge')).toBeNull();
  });

  it('shows the pressed state and an occurrence count once marks are on', () => {
    keywordMarkStore.togglePane('bible', true);
    paint();
    render(<KeywordMarksButton />);
    expect(screen.getByTestId('keyword-marks-toggle').getAttribute('aria-pressed')).toBe('true');
    const total = keywordMarkStore.legend('bible').reduce((n, r) => n + r.hits, 0);
    expect(total).toBeGreaterThan(0);
    expect(screen.getByTestId('keyword-marks-badge').textContent).toBe(String(total));
  });

  it('opens the legend with a row per built-in mark and toggles a row', async () => {
    keywordMarkStore.togglePane('bible', true);
    paint();
    render(<KeywordMarksButton />);
    fireEvent.click(screen.getByTestId('keyword-marks-toggle'));
    const hide = screen.getAllByRole('button', { name: /keywordMarks\.hide/ })[0];
    fireEvent.click(hide);
    await waitFor(() => expect(keywordMarkStore.getPaneState('bible').hiddenMarkIds).toHaveLength(1));
  });

  it('steps through occurrences: scrolls, flashes the word and announces it', () => {
    keywordMarkStore.togglePane('bible', true);
    paint();
    const row = keywordMarkStore.legend('bible')[0];
    const first = keywordMarkStore.occurrencesOf('bible', row.markId)[0];
    document.body.innerHTML = `<div data-verse-id="${first.verseId}">${
      Array.from({ length: 12 }, (_, i) => `<span class="word" data-word-index="${i}">w${i}</span>`).join('')}</div>`;
    const scroll = vi.fn();
    (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
    render(<KeywordMarksButton />, { container: document.body.appendChild(document.createElement('div')) });
    fireEvent.click(screen.getByTestId('keyword-marks-toggle'));
    fireEvent.click(screen.getAllByRole('button', { name: /keywordMarks\.next/ })[0]);
    expect(scroll).toHaveBeenCalled();
    expect(document.querySelector(`[data-word-index="${first.start}"]`)!.classList.contains('keyword-flash')).toBe(true);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('"index":1');
    expect(status.textContent).toContain(`"total":${row.hits}`);
    fireEvent.click(screen.getAllByRole('button', { name: /keywordMarks\.prev/ })[0]);
    expect(screen.getByRole('status').textContent).toContain(`"index":${row.hits}`);
  });

  it('offers no add, edit, manage-sets or suggestion controls (web is read-only for personal content)', () => {
    keywordMarkStore.togglePane('bible', true);
    paint();
    render(<KeywordMarksButton />);
    fireEvent.click(screen.getByTestId('keyword-marks-toggle'));
    expect(screen.getAllByRole('button', { name: /keywordMarks\.hide/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'keywordMarks.add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'keywordMarks.manageSets' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /keywordMarks\.edit/ })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /keywordMarks\.addSuggestion/ })).toHaveLength(0);
  });
});
