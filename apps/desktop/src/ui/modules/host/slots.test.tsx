/**
 * The reader slot outlets (task 0127): they render whatever is registered, pass the props through,
 * fire `onView:bible` when a host view with module slots mounts, and render nothing when empty.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEffect } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  ReaderPaintControllers,
  ReaderChapterEnd,
  NewTabRows,
  readerChapterEnd,
  newTabRows,
  ReaderToolbarItems,
  StudyPaneSections,
  StrongsTooltipActions,
  WordMenuItems,
  ShellOverlays,
  VerseMenuItems,
  shellOverlays,
  verseMenuItems,
  readerPaintControllers,
  readerToolbarItems,
  setViewActivator,
  strongsTooltipActions,
  studyPaneSections,
  wordMenuItems,
} from './slots';

afterEach(() => {
  cleanup();
  setViewActivator(() => {});
});

const paintProps = {
  tabId: 't1', moduleId: 5, abbreviation: 'KJV', language: 'en', bookNumber: 43, chapter: 3, verses: [],
  surface: 'standard' as const, uiLocale: 'en', active: true, containerRef: { current: null },
};

describe('reader slot outlets', () => {
  it('render nothing while empty', () => {
    const { container } = render(
      <>
        <ReaderPaintControllers {...paintProps} />
        <ReaderToolbarItems tabId="t1" />
        <StudyPaneSections verseId={1} sectionsCollapsed={{}} toggleSection={() => {}} />
        <WordMenuItems tabId="t1" wordText="God" onClose={() => {}} />
        <StrongsTooltipActions tabId="t1" strongsNumber="G25" onClose={() => {}} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('render registered items with the host props, and stop when the item is disposed', () => {
    const regs = [
      readerPaintControllers.register((p) => <i data-testid="paint">{p.tabId}:{p.chapter}</i>),
      readerToolbarItems.register((p) => <i data-testid="bar">{p.tabId}</i>),
      studyPaneSections.register((p) => <i data-testid="study">{p.verseId}</i>),
      wordMenuItems.register((p) => <i data-testid="word">{p.wordText}</i>),
      strongsTooltipActions.register((p) => <i data-testid="strongs">{p.strongsNumber}</i>),
    ];
    render(
      <>
        <ReaderPaintControllers {...paintProps} />
        <ReaderToolbarItems tabId="t1" />
        <StudyPaneSections verseId={7} sectionsCollapsed={{}} toggleSection={() => {}} />
        <WordMenuItems tabId="t1" wordText="God" onClose={() => {}} />
        <StrongsTooltipActions tabId="t1" strongsNumber="G25" onClose={() => {}} />
      </>,
    );
    expect(screen.getByTestId('paint')).toHaveTextContent('t1:3');
    expect(screen.getByTestId('bar')).toHaveTextContent('t1');
    expect(screen.getByTestId('study')).toHaveTextContent('7');
    expect(screen.getByTestId('word')).toHaveTextContent('God');
    expect(screen.getByTestId('strongs')).toHaveTextContent('G25');
    for (const r of regs) r.dispose();
  });

  it('fire onView:bible when a view with module slots mounts', () => {
    const fire = vi.fn();
    setViewActivator(fire);
    render(<ReaderPaintControllers {...paintProps} />);
    render(<ReaderToolbarItems tabId="t1" />);
    render(<StudyPaneSections verseId={1} sectionsCollapsed={{}} toggleSection={() => {}} />);
    expect(fire).toHaveBeenCalledWith('onView:bible');
    expect(fire).toHaveBeenCalledTimes(3);
  });
});

describe('stable keys', () => {
  it('disposing one verse-menu item or overlay does not remount the others', () => {
    const mounts = vi.fn();
    const First = () => <i data-testid="first" />;
    const Second = () => {
      useEffect(() => mounts(), []);
      return <i data-testid="second" />;
    };
    const regs = [verseMenuItems.register(First as never), verseMenuItems.register(Second as never), shellOverlays.register(First), shellOverlays.register(Second)];
    render(
      <>
        <VerseMenuItems {...({} as React.ComponentProps<typeof VerseMenuItems>)} />
        <ShellOverlays />
      </>,
    );
    expect(mounts).toHaveBeenCalledTimes(2);
    act(() => {
      regs[0]!.dispose();
      regs[2]!.dispose();
    });
    expect(mounts).toHaveBeenCalledTimes(2);
    regs[1]!.dispose();
    regs[3]!.dispose();
  });
});

describe('readerChapterEnd and newTabRows (task 0222)', () => {
  it('render nothing while empty', () => {
    const { container } = render(
      <>
        <ReaderChapterEnd book={1} chapter={1} displayMode="standard" onNext={() => {}} />
        <NewTabRows onDone={() => {}} />
      </>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('pass the props through and drop an item when disposed', () => {
    const onNext = vi.fn();
    const onDone = vi.fn();
    const End = (p: { book: number; chapter: number; displayMode: string; onNext: () => void }) => (
      <button data-testid="end" onClick={p.onNext}>{`${p.book}:${p.chapter}:${p.displayMode}`}</button>
    );
    const Row = (p: { onDone: () => void }) => <button data-testid="row" onClick={p.onDone} />;
    const regs = [readerChapterEnd.register(End), newTabRows.register(Row)];
    render(
      <>
        <ReaderChapterEnd book={43} chapter={3} displayMode="parallel" onNext={onNext} />
        <NewTabRows onDone={onDone} />
      </>,
    );
    expect(screen.getByTestId('end').textContent).toBe('43:3:parallel');
    screen.getByTestId('end').click();
    screen.getByTestId('row').click();
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => regs.forEach((r) => r.dispose()));
    expect(screen.queryByTestId('end')).toBeNull();
    expect(screen.queryByTestId('row')).toBeNull();
  });
});
