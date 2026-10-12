import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../../utils/verseId', () => ({ formatVerseRange: (a: number) => `ref${a}` }));

import { createHighlightDecorator } from './highlightDecorator';
import { annotationUi } from './annotationUi';
import type { AnnotationStore, VerseAnnotations } from './annotationStore';
import type { ReaderVerseContext } from '../../host/slots';

const ctx = (verseId: number): ReaderVerseContext => ({
  tabId: 't', moduleAbbr: 'KJV', book: 43, chapter: 3, verseId, verse: verseId % 1000, html: '', isActive: false,
});
const storeWith = (map: Record<number, VerseAnnotations>) => ({ forVerse: (_t: string, id: number) => map[id] }) as unknown as AnnotationStore;

beforeEach(() => annotationUi.reset());

describe('highlight decorator', () => {
  it('returns nothing for plain verses', () => {
    expect(createHighlightDecorator(storeWith({}))(ctx(43003016))).toBeUndefined();
  });

  it('adds tint classes from the palette name, custom colours get the neutral class', () => {
    const d = createHighlightDecorator(storeWith({
      1: { highlight: { id: 1, moduleId: 1, start: 1, end: 1, color: '#B7E4C7' }, notes: [] },
      2: { highlight: { id: 2, moduleId: 1, start: 2, end: 2, color: '#123456' }, notes: [] },
    }));
    expect(d(ctx(1))).toEqual({ classes: ['kth-annot-hl', 'kth-annot-hl--green'] });
    expect(d(ctx(2))).toEqual({ classes: ['kth-annot-hl', 'kth-annot-hl--custom'] });
    expect(d(ctx(1))).toBe(d(ctx(1))); // stable object per colour
  });

  it('renders note and bookmark marks in the rail; the note mark opens the editor without selecting the verse', () => {
    const note = { id: 4, start: 5, end: 5, title: 'Tit', content: '<p>c</p>', modified: 'm' };
    const d = createHighlightDecorator(storeWith({ 5: { notes: [note], bookmark: { id: 8, start: 5, end: 5, title: null } } }));
    const out = d(ctx(5))!;
    expect(out.classes).toBeUndefined();
    const onVerseClick = vi.fn();
    render(<div onClick={onVerseClick}>{out.rail as ComponentChildren}</div>);
    expect(screen.getByRole('img', { name: 'annotations.mark.bookmarked' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'annotations.mark.editNote' }));
    expect(onVerseClick).not.toHaveBeenCalled();
    expect(annotationUi.note).toEqual({ start: 5, end: 5, reference: 'ref5', note });
  });

  it('shows only the bookmark mark when there is no note', () => {
    const d = createHighlightDecorator(storeWith({ 5: { notes: [], bookmark: { id: 8, start: 5, end: 5, title: null } } }));
    render(<div>{d(ctx(5))!.rail as ComponentChildren}</div>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('img')).toBeTruthy();
  });
});
