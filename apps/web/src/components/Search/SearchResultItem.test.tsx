// @vitest-environment jsdom
// ^ These components sanitize module HTML, and DOMPurify mangles its own
// output under the happy-dom this suite otherwise runs on — it drops the first
// node of a fragment. Browsers are unaffected; see src/utils/sanitize.test.ts.
/**
 * Component tests for SearchResultItem.
 *
 * Pattern: Pure presentational component with props and click handlers.
 * No store integration — tests verify rendering and event callbacks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

import { SearchResultItem } from './SearchResultItem';
import type { SearchResultData } from '../../types';

function makeResult(overrides: Partial<SearchResultData> = {}): SearchResultData {
  return {
    verseId: 43003016,
    reference: 'John 3:16',
    text: 'For God so loved the world...',
    module: 'KJV',
    type: 'exact',
    ...overrides,
  };
}

describe('SearchResultItem', () => {
  it('renders reference and module', () => {
    const result = makeResult();
    render(
      <SearchResultItem result={result} onClick={vi.fn()} onCtrlClick={vi.fn()} />,
    );

    expect(screen.getByText('John 3:16')).toBeTruthy();
    expect(screen.getByText('KJV')).toBeTruthy();
  });

  it('renders text when no snippet', () => {
    const result = makeResult({ text: 'Full verse text here' });
    const { container } = render(
      <SearchResultItem result={result} onClick={vi.fn()} onCtrlClick={vi.fn()} />,
    );

    const textEl = container.querySelector('.search-result-item__text');
    expect(textEl?.innerHTML).toBe('Full verse text here');
  });

  it('renders snippet when provided (as HTML)', () => {
    const result = makeResult({ snippet: 'For <mark>God</mark> so loved' });
    const { container } = render(
      <SearchResultItem result={result} onClick={vi.fn()} onCtrlClick={vi.fn()} />,
    );

    const textEl = container.querySelector('.search-result-item__text');
    expect(textEl?.innerHTML).toBe('For <mark>God</mark> so loved');
  });

  it('renders title when provided', () => {
    const result = makeResult({ title: 'Most Famous Verse' });
    render(
      <SearchResultItem result={result} onClick={vi.fn()} onCtrlClick={vi.fn()} />,
    );

    expect(screen.getByText('Most Famous Verse')).toBeTruthy();
  });

  it('does not render title element when title is absent', () => {
    const result = makeResult({ title: undefined });
    const { container } = render(
      <SearchResultItem result={result} onClick={vi.fn()} onCtrlClick={vi.fn()} />,
    );

    expect(container.querySelector('.search-result-item__title')).toBeNull();
  });

  it('calls onClick on normal click', () => {
    const result = makeResult();
    const onClick = vi.fn();
    const { container } = render(
      <SearchResultItem result={result} onClick={onClick} onCtrlClick={vi.fn()} />,
    );

    fireEvent.click(container.querySelector('.search-result-item')!);
    expect(onClick).toHaveBeenCalledWith(result);
  });

  it('calls onCtrlClick on ctrl+click', () => {
    const result = makeResult();
    const onCtrlClick = vi.fn();
    const { container } = render(
      <SearchResultItem result={result} onClick={vi.fn()} onCtrlClick={onCtrlClick} />,
    );

    fireEvent.click(container.querySelector('.search-result-item')!, { ctrlKey: true });
    expect(onCtrlClick).toHaveBeenCalledWith(result);
  });

  it('calls onCtrlClick on meta+click (macOS)', () => {
    const result = makeResult();
    const onCtrlClick = vi.fn();
    const { container } = render(
      <SearchResultItem result={result} onClick={vi.fn()} onCtrlClick={onCtrlClick} />,
    );

    fireEvent.click(container.querySelector('.search-result-item')!, { metaKey: true });
    expect(onCtrlClick).toHaveBeenCalledWith(result);
  });

  it('applies last-clicked class when lastClicked is true', () => {
    const result = makeResult();
    const { container } = render(
      <SearchResultItem result={result} onClick={vi.fn()} onCtrlClick={vi.fn()} lastClicked />,
    );

    expect(container.querySelector('.search-result-item--last-clicked')).toBeTruthy();
  });

  it('does not apply last-clicked class when lastClicked is false', () => {
    const result = makeResult();
    const { container } = render(
      <SearchResultItem result={result} onClick={vi.fn()} onCtrlClick={vi.fn()} lastClicked={false} />,
    );

    expect(container.querySelector('.search-result-item--last-clicked')).toBeNull();
  });
  // ------------------------------------------------------------------
  // Match-type badge
  // ------------------------------------------------------------------
  it('badges an approximate match and sinks the row', () => {
    const { container } = render(
      <SearchResultItem result={makeResult({ type: 'fuzzy' })} onClick={vi.fn()} onCtrlClick={vi.fn()} />,
    );
    expect(screen.getByTestId('search-result-fuzzy-badge')).toBeTruthy();
    expect(container.querySelector('.search-result-item--fuzzy')).toBeTruthy();
  });

  it('leaves exact and stem matches unbadged', () => {
    for (const type of ['exact', 'stem'] as const) {
      const { container, unmount } = render(
        <SearchResultItem result={makeResult({ type })} onClick={vi.fn()} onCtrlClick={vi.fn()} />,
      );
      expect(container.querySelector('[data-testid="search-result-fuzzy-badge"]')).toBeNull();
      expect(container.querySelector('.search-result-item--fuzzy')).toBeNull();
      unmount();
    }
  });

  it('publishes the row id so the distribution chart can scroll to it', () => {
    const { container } = render(
      <SearchResultItem
        result={makeResult()}
        resultId="KJV|exact|43003016|43003016"
        onClick={vi.fn()}
        onCtrlClick={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-result-id="KJV|exact|43003016|43003016"]')).toBeTruthy();
  });
});
