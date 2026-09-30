/**
 * Component tests for StrongsPopup.
 *
 * Pattern: Store-connected presentational dialog. Renders nothing when
 * entry/position are null. Tests cover: rendering with valid data, close
 * button, overlay click, Escape key handler, definition parsing (glosses /
 * description / transliteration), optional etymology, and the "search
 * occurrences" button that calls searchStore and commentaryStore.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// Mock stores that are called inside StrongsPopup
vi.mock('../../stores/searchStore', () => ({
  searchStore: {
    performSearch: vi.fn(),
  },
}));
vi.mock('../../stores/commentaryStore', () => ({
  commentaryStore: {
    setRightPaneMode: vi.fn(),
  },
}));

import { StrongsPopup } from './StrongsPopup';
import type { StrongsEntryData } from '../../types';
import { searchStore } from '../../stores/searchStore';
import { commentaryStore } from '../../stores/commentaryStore';

function makeEntry(overrides: Partial<StrongsEntryData> = {}): StrongsEntryData {
  return {
    strongsNumber: 'G25',
    word: 'ἀγάπη',
    transliteration: 'agape',
    definition: 'love unconditionally',
    partOfSpeech: 'noun',
    ...overrides,
  };
}

const DEFAULT_POSITION = { top: 100, left: 200 };

describe('StrongsPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when entry is null', () => {
    const { container } = render(
      <StrongsPopup entry={null} position={DEFAULT_POSITION} onClose={vi.fn()} />,
    );
    expect(container.querySelector('.strongs-popup-overlay')).toBeNull();
  });

  it('renders nothing when position is null', () => {
    const { container } = render(
      <StrongsPopup entry={makeEntry()} position={null} onClose={vi.fn()} />,
    );
    expect(container.querySelector('.strongs-popup-overlay')).toBeNull();
  });

  it('renders the popup overlay when entry and position are provided', () => {
    const { container } = render(
      <StrongsPopup entry={makeEntry()} position={DEFAULT_POSITION} onClose={vi.fn()} />,
    );
    expect(container.querySelector('.strongs-popup-overlay')).toBeTruthy();
    expect(container.querySelector('.strongs-popup')).toBeTruthy();
  });

  it('displays the Strongs number and word', () => {
    render(
      <StrongsPopup entry={makeEntry()} position={DEFAULT_POSITION} onClose={vi.fn()} />,
    );
    expect(screen.getByText('G25')).toBeTruthy();
    expect(screen.getByText('ἀγάπη')).toBeTruthy();
  });

  it('applies the position style to the popup element', () => {
    const { container } = render(
      <StrongsPopup entry={makeEntry()} position={{ top: 150, left: 300 }} onClose={vi.fn()} />,
    );
    const popup = container.querySelector('.strongs-popup') as HTMLElement;
    expect(popup.style.top).toBe('150px');
    expect(popup.style.left).toBe('300px');
  });

  it('shows the transliteration from the entry', () => {
    render(
      <StrongsPopup entry={makeEntry({ transliteration: 'agape' })} position={DEFAULT_POSITION} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/agape/)).toBeTruthy();
  });

  it('shows the part of speech', () => {
    render(
      <StrongsPopup entry={makeEntry({ partOfSpeech: 'noun, feminine' })} position={DEFAULT_POSITION} onClose={vi.fn()} />,
    );
    expect(screen.getByText('noun, feminine')).toBeTruthy();
  });

  it('does not render part-of-speech element when empty', () => {
    const { container } = render(
      <StrongsPopup entry={makeEntry({ partOfSpeech: '' })} position={DEFAULT_POSITION} onClose={vi.fn()} />,
    );
    expect(container.querySelector('.strongs-popup__pos')).toBeNull();
  });

  it('shows etymology when provided', () => {
    render(
      <StrongsPopup
        entry={makeEntry({ etymology: 'from agan (much) + a root' })}
        position={DEFAULT_POSITION}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/strongsPopup.etymology/)).toBeTruthy();
  });

  it('does not show etymology section when absent', () => {
    const { container } = render(
      <StrongsPopup entry={makeEntry({ etymology: undefined })} position={DEFAULT_POSITION} onClose={vi.fn()} />,
    );
    expect(container.querySelector('.strongs-popup__etym')).toBeNull();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <StrongsPopup entry={makeEntry()} position={DEFAULT_POSITION} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector('.strongs-popup__close')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the overlay background is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <StrongsPopup entry={makeEntry()} position={DEFAULT_POSITION} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector('.strongs-popup-overlay')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT call onClose when the popup content is clicked (stopPropagation)', () => {
    const onClose = vi.fn();
    const { container } = render(
      <StrongsPopup entry={makeEntry()} position={DEFAULT_POSITION} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector('.strongs-popup')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<StrongsPopup entry={makeEntry()} position={DEFAULT_POSITION} onClose={onClose} />);
    // The component registers a keydown listener on window. Dispatch a native
    // KeyboardEvent so the listener fires (happy-dom does not bubble fireEvent
    // to window listeners when the event is dispatched on the window object itself).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not add Escape listener when entry is null (no popup shown)', () => {
    const onClose = vi.fn();
    render(<StrongsPopup entry={null} position={null} onClose={onClose} />);
    // Dispatched natively for the same reason as the test above: a
    // `fireEvent.keyDown(window, …)` never reaches a window listener under
    // happy-dom, so it would pass here even if the listener were registered.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // onClose should not have been triggered since there was no entry to register the handler
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the search occurrences button', () => {
    render(<StrongsPopup entry={makeEntry()} position={DEFAULT_POSITION} onClose={vi.fn()} />);
    expect(screen.getByText('strongsPopup.searchOccurrences')).toBeTruthy();
  });

  it('keeps the search button outside the scrollable body so a long definition cannot hide it', () => {
    // One `overflow-y: auto` box scrolls every element together -- including
    // the search button pinned at the bottom of the markup. Long definitions
    // (the common case) then push the button out of the visible 400px and it
    // looks like it does not exist.
    // The button must be a sibling of the scrolling body, not a descendant.
    const { container } = render(
      <StrongsPopup
        entry={makeEntry({ definition: 'a very long definition. '.repeat(200) })}
        position={DEFAULT_POSITION}
        onClose={vi.fn()}
      />,
    );

    const body = container.querySelector('.strongs-popup__body');
    const button = container.querySelector('.strongs-popup__search-btn');
    expect(body).toBeTruthy();
    expect(button).toBeTruthy();
    expect(body!.contains(button!)).toBe(false);
    expect(button!.parentElement).toBe(container.querySelector('.strongs-popup'));
  });

  it('puts the definition inside the scrollable body', () => {
    const { container } = render(
      <StrongsPopup entry={makeEntry()} position={DEFAULT_POSITION} onClose={vi.fn()} />,
    );
    const body = container.querySelector('.strongs-popup__body');
    expect(body!.querySelector('.strongs-popup__def')).toBeTruthy();
  });

  it('clicking search button calls searchStore.performSearch with Strongs number', () => {
    const onClose = vi.fn();
    render(<StrongsPopup entry={makeEntry({ strongsNumber: 'G25' })} position={DEFAULT_POSITION} onClose={onClose} />);
    fireEvent.click(screen.getByText('strongsPopup.searchOccurrences'));
    expect(searchStore.performSearch).toHaveBeenCalledWith('G25');
  });

  it('clicking search button calls commentaryStore.setRightPaneMode("search")', () => {
    const onClose = vi.fn();
    render(<StrongsPopup entry={makeEntry()} position={DEFAULT_POSITION} onClose={onClose} />);
    fireEvent.click(screen.getByText('strongsPopup.searchOccurrences'));
    expect(commentaryStore.setRightPaneMode).toHaveBeenCalledWith('search');
  });

  it('clicking search button calls onClose', () => {
    const onClose = vi.fn();
    render(<StrongsPopup entry={makeEntry()} position={DEFAULT_POSITION} onClose={onClose} />);
    fireEvent.click(screen.getByText('strongsPopup.searchOccurrences'));
    expect(onClose).toHaveBeenCalled();
  });

  it('parses definition with :-- separator to produce glosses', () => {
    const entry = makeEntry({
      definition: '1234 word xlit pron {pron} description text:--gloss one, gloss two',
      transliteration: '',
    });
    const { container } = render(
      <StrongsPopup entry={entry} position={DEFAULT_POSITION} onClose={vi.fn()} />,
    );
    expect(container.querySelector('.strongs-popup__glosses')).toBeTruthy();
  });

  it('does not render glosses element when definition has no :-- separator', () => {
    const entry = makeEntry({ definition: 'a simple definition with no separator' });
    const { container } = render(
      <StrongsPopup entry={entry} position={DEFAULT_POSITION} onClose={vi.fn()} />,
    );
    expect(container.querySelector('.strongs-popup__glosses')).toBeNull();
  });
});
