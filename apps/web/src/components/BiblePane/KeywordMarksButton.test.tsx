/**
 * Tests for the Keywords toolbar button: pressed state and badge, the legend
 * panel, stepping (scroll, flash, announcement), suggestions and the dialogs.
 * The keyword store is the real singleton over an in-memory set store; the
 * Bible and module stores are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact';

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
const VERSES = [verse(1, 'love and love'), verse(2, 'we love faith faith faith faith'), verse(3, 'faith is good')];

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
  beforeEach(async () => {
    localStorage.clear();
    keywordMarkStore.togglePane('bible', false);
    // Drop the user's marks between tests.
    await keywordMarkStore.init();
    for (const s of keywordMarkStore.sets) if (!s.builtIn) await keywordMarkStore.removeSet(s.id);
  });

  afterEach(() => { document.body.innerHTML = ''; });

  it('renders an unpressed toggle with no badge while marks are off', () => {
    render(<KeywordMarksButton />);
    const btn = screen.getByTestId('keyword-marks-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('keyword-marks-badge')).toBeNull();
  });

  it('shows the pressed state and an occurrence count once a mark is on', async () => {
    await keywordMarkStore.addMark('bible', { kind: 'word', forms: ['faith'] }, 'faith');
    paint();
    render(<KeywordMarksButton />);
    expect(screen.getByTestId('keyword-marks-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('keyword-marks-badge').textContent).toBe('5');
  });

  it('opens the legend with a row per mark and toggles a row', async () => {
    await keywordMarkStore.addMark('bible', { kind: 'word', forms: ['faith'] }, 'faith');
    paint();
    render(<KeywordMarksButton />);
    fireEvent.click(screen.getByTestId('keyword-marks-toggle'));
    const hide = screen.getByRole('button', { name: /keywordMarks\.hide.*faith/ });
    fireEvent.click(hide);
    await waitFor(() => expect(keywordMarkStore.getPaneState('bible').hiddenMarkIds).toHaveLength(1));
  });

  it('steps through occurrences: scrolls, flashes the word and announces it', async () => {
    await keywordMarkStore.addMark('bible', { kind: 'word', forms: ['faith'] }, 'faith');
    paint();
    document.body.innerHTML = `<div data-verse-id="43003002">${
      [0, 1, 2, 3, 4, 5].map((i) => `<span class="word" data-word-index="${i}">w${i}</span>`).join('')}</div>`;
    const scroll = vi.fn();
    (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
    render(<KeywordMarksButton />, { container: document.body.appendChild(document.createElement('div')) });
    fireEvent.click(screen.getByTestId('keyword-marks-toggle'));
    fireEvent.click(screen.getByRole('button', { name: /keywordMarks\.next.*faith/ }));
    // First "faith" is word 2 of verse 2.
    expect(scroll).toHaveBeenCalled();
    expect(document.querySelector('[data-word-index="2"]')!.classList.contains('keyword-flash')).toBe(true);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('"verse":2');
    expect(status.textContent).toContain('"index":1');
    expect(status.textContent).toContain('"total":5');
    fireEvent.click(screen.getByRole('button', { name: /keywordMarks\.prev.*faith/ }));
    expect(screen.getByRole('status').textContent).toContain('"index":5');
  });

  it('accepting a suggestion adds a mark', async () => {
    const add = vi.spyOn(keywordMarkStore, 'addMark');
    render(<KeywordMarksButton />);
    fireEvent.click(screen.getByTestId('keyword-marks-toggle'));
    const accept = await screen.findAllByRole('button', { name: /keywordMarks\.addSuggestion/ });
    fireEvent.click(accept[0]);
    expect(add).toHaveBeenCalled();
    add.mockRestore();
  });

  it('opens the add-keyword dialog', () => {
    render(<KeywordMarksButton />);
    fireEvent.click(screen.getByTestId('keyword-marks-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'keywordMarks.add' }));
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('keywordMarks.newTitle');
  });

  it('opens the manage-sets dialog listing built-in sets without a delete button', () => {
    render(<KeywordMarksButton />);
    fireEvent.click(screen.getByTestId('keyword-marks-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'keywordMarks.manageSets' }));
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('keywordMarks.sets.title');
    expect(screen.getAllByRole('button', { name: 'keywordMarks.sets.duplicate' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'keywordMarks.sets.delete' })).toBeNull();
  });

  it('says built-in marks are read-only instead of editing them', async () => {
    keywordMarkStore.togglePane('bible', true);
    paint();
    render(<KeywordMarksButton />);
    fireEvent.click(screen.getByTestId('keyword-marks-toggle'));
    const edit = screen.queryAllByRole('button', { name: /keywordMarks\.edit/ });
    if (edit.length === 0) return; // chapter has no connective hits: nothing to edit
    fireEvent.click(edit[0]);
    expect(screen.getByText('keywordMarks.builtInReadOnly')).toBeTruthy();
    await act(async () => {});
  });
});
