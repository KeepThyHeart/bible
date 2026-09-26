import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookChapterPicker } from './BookChapterPicker';
import type { BookChapterPickerProps } from './BookChapterPicker';

const NAMES: Record<number, string> = {
  1: 'Genesis', 2: 'Exodus', 19: 'Psalms', 31: 'Obadiah', 40: 'Matthew', 43: 'John', 46: '1 Corinthians', 65: 'Jude',
};
const bookName = (n: number) => NAMES[n] ?? `Book ${n}`;

function setup(props: Partial<BookChapterPickerProps> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  const utils = render(<BookChapterPicker bookName={bookName} onPick={onPick} onClose={onClose} {...props} />);
  return { onPick, onClose, ...utils };
}

const input = () => screen.getByPlaceholderText(/Type a reference/);

describe('BookChapterPicker: book list', () => {
  it('shows the heading, both testaments and one cell per book', () => {
    const { container } = setup();
    expect(screen.getByRole('heading', { name: 'Go to Passage' })).toBeInTheDocument();
    expect(screen.getByText('Old Testament')).toBeInTheDocument();
    expect(screen.getByText('New Testament')).toBeInTheDocument();
    expect(container.querySelectorAll('.kth-picker__cell--book')).toHaveLength(66);
    expect(screen.getByRole('button', { name: 'Genesis' })).toBeInTheDocument();
  });

  it('groups the cells by testament with accessible group names', () => {
    setup();
    expect(screen.getByRole('group', { name: 'Old Testament' })).toContainElement(screen.getByRole('button', { name: 'Genesis' }));
    expect(screen.getByRole('group', { name: 'New Testament' })).toContainElement(screen.getByRole('button', { name: 'John' }));
  });

  it('marks the current book with aria-current and the active class, and no other', () => {
    const { container } = setup({ current: { book: 43, chapter: 3 } });
    const john = screen.getByRole('button', { name: 'John' });
    expect(john).toHaveAttribute('aria-current', 'true');
    expect(john).toHaveClass('kth-picker__cell--active');
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  });

  it('uses the soft appearance for the current book when asked', () => {
    setup({ current: { book: 43 }, currentBookAppearance: 'soft' });
    const john = screen.getByRole('button', { name: 'John' });
    expect(john).toHaveClass('kth-picker__cell--current');
    expect(john).not.toHaveClass('kth-picker__cell--active');
  });

  it('sets a title and a data-section on every cell', () => {
    setup();
    const john = screen.getByRole('button', { name: 'John' });
    expect(john).toHaveAttribute('title', 'John');
    expect(john).toHaveAttribute('data-section', 'gospels');
  });

  it('applies cellStyle to other books but never to the current book', () => {
    setup({ current: { book: 1 }, cellStyle: () => ({ backgroundColor: 'rgb(1, 2, 3)' }) });
    expect(screen.getByRole('button', { name: 'Exodus' }).style.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(screen.getByRole('button', { name: 'Genesis' }).style.backgroundColor).toBe('');
  });

  it('picks a single-chapter book immediately', async () => {
    const user = userEvent.setup();
    const { onPick } = setup();
    await user.click(screen.getByRole('button', { name: 'Obadiah' }));
    expect(onPick).toHaveBeenCalledWith(31, 1);
  });

  it('shows short names in a compact grid until a filter is typed', async () => {
    const user = userEvent.setup();
    const { container } = setup({ compact: true, shortBookName: (n) => `#${n}` });
    expect(screen.getByRole('button', { name: '#43' })).toHaveAttribute('title', 'John');
    expect(container.querySelector('.kth-picker__grid--compact')).not.toBeNull();
    await user.type(input(), 'john');
    expect(container.querySelector('.kth-picker__grid--compact')).toBeNull();
    expect(screen.getByRole('button', { name: 'John' })).toBeInTheDocument();
  });

  it('applies dir and titleId', () => {
    const { container } = setup({ dir: 'rtl', titleId: 'my-title' });
    expect(container.querySelector('.kth-picker')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'Go to Passage' })).toHaveAttribute('id', 'my-title');
  });

  it('takes labels from props with English defaults for the rest', () => {
    setup({ labels: { title: 'Ir al pasaje', oldTestament: 'Antiguo Testamento' } });
    expect(screen.getByRole('heading', { name: 'Ir al pasaje' })).toBeInTheDocument();
    expect(screen.getByText('Antiguo Testamento')).toBeInTheDocument();
    expect(screen.getByText('New Testament')).toBeInTheDocument();
  });

  it('gives each mounted picker its own group ids', () => {
    render(
      <>
        <BookChapterPicker bookName={bookName} onPick={vi.fn()} />
        <BookChapterPicker bookName={bookName} onPick={vi.fn()} />
      </>,
    );
    const ids = screen.getAllByText('Old Testament').map((el) => el.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('BookChapterPicker: filtering', () => {
  it('filters the list as the user types, by name, abbreviation and alias', async () => {
    const user = userEvent.setup();
    setup({ bookAliases: { jn: 43 } });
    await user.type(input(), 'john');
    expect(screen.getByRole('button', { name: 'John' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Genesis' })).not.toBeInTheDocument();
    await user.clear(input());
    await user.type(input(), 'jn');
    expect(screen.getByRole('button', { name: 'John' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exodus' })).not.toBeInTheDocument();
  });

  it('matches roman numeral prefixes ("i cor")', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(input(), 'i cor');
    expect(screen.getByRole('button', { name: '1 Corinthians' })).toBeInTheDocument();
  });

  it('shows the no-match message and hides the testament headings', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(input(), 'zzzq');
    expect(screen.getByText('No matching books')).toBeInTheDocument();
    expect(screen.queryByText('Old Testament')).not.toBeInTheDocument();
  });
});

describe('BookChapterPicker: chapter grid', () => {
  it('opens the chapter grid for a multi-chapter book, with named cells', async () => {
    const user = userEvent.setup();
    setup({ current: { book: 43, chapter: 3 } });
    await user.click(screen.getByRole('button', { name: 'John' }));
    expect(screen.getByRole('heading', { name: 'John' })).toBeInTheDocument();
    expect(screen.getByText('Select a chapter')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^John chapter \d+$/ })).toHaveLength(21);
    expect(screen.getByRole('button', { name: 'John chapter 3' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'John chapter 4' })).not.toHaveAttribute('aria-current');
  });

  it('does not mark a chapter current when another book is open', async () => {
    const user = userEvent.setup();
    setup({ current: { book: 43, chapter: 3 } });
    await user.click(screen.getByRole('button', { name: 'Genesis' }));
    expect(screen.getByRole('group', { name: 'Select a chapter' }).querySelector('[aria-current]')).toBeNull();
  });

  it('picks book and chapter with exactly two arguments', async () => {
    const user = userEvent.setup();
    const { onPick } = setup();
    await user.click(screen.getByRole('button', { name: 'John' }));
    await user.click(screen.getByRole('button', { name: 'John chapter 3' }));
    expect(onPick).toHaveBeenCalledWith(43, 3);
  });

  it('goes back to the book list with the Back button', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'John' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Go to Passage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Genesis' })).toBeInTheDocument();
  });

  it('renders app extras under the chapter grid for the chosen book', async () => {
    const user = userEvent.setup();
    setup({ chapterExtras: (book) => <div data-testid="extras">extras for {book}</div> });
    await user.click(screen.getByRole('button', { name: 'John' }));
    expect(screen.getByTestId('extras')).toHaveTextContent('extras for 43');
  });

  it('a bare number picks that chapter of the open book', async () => {
    const user = userEvent.setup();
    const { onPick } = setup();
    await user.click(screen.getByRole('button', { name: 'John' }));
    await user.type(input(), '5{Enter}');
    expect(onPick).toHaveBeenCalledWith(43, 5);
  });

  it('a bare number falls back to the current book, and ignores out-of-range numbers', async () => {
    const user = userEvent.setup();
    const { onPick } = setup({ current: { book: 43, chapter: 1 }, search: { onSearch: vi.fn(), results: () => null } });
    await user.type(input(), '99{Enter}');
    expect(onPick).not.toHaveBeenCalled();
    await user.clear(input());
    await user.type(input(), '21{Enter}');
    expect(onPick).toHaveBeenCalledWith(43, 21);
  });
});

describe('BookChapterPicker: chrome and keyboard', () => {
  it('calls onClose from the close button', async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits the close button without onClose', () => {
    render(<BookChapterPicker bookName={bookName} onPick={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('Escape closes from the book list', () => {
    const { onClose } = setup();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape steps back from the chapter grid first, then closes', async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'John' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Go to Passage' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while suspended, and other keys always', () => {
    const { onClose } = setup({ escapeSuspended: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening for Escape once unmounted', () => {
    const { onClose, unmount } = setup();
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses the reference input on mount, unless told not to', async () => {
    setup();
    await vi.waitFor(() => expect(input()).toHaveFocus());
  });

  it('does not steal focus with autoFocusInput={false}', async () => {
    setup({ autoFocusInput: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(input()).not.toHaveFocus();
  });

  it('returns focus to the input when stepping back', async () => {
    const user = userEvent.setup();
    setup({ autoFocusInput: false });
    await user.click(screen.getByRole('button', { name: 'John' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await vi.waitFor(() => expect(input()).toHaveFocus());
  });

  it('renders icons and slots, and names an icon-only Go button', () => {
    setup({
      icons: { close: <i data-testid="close-icon" />, go: <i data-testid="go-icon" /> },
      afterReference: <div data-testid="after-ref" />,
    });
    expect(screen.getByTestId('close-icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toContainElement(screen.getByTestId('go-icon'));
    expect(screen.getByTestId('after-ref')).toBeInTheDocument();
  });
});

describe('BookChapterPicker: typed references', () => {
  const submit = async (text: string, props: Partial<BookChapterPickerProps> = {}) => {
    const user = userEvent.setup();
    const utils = setup(props);
    await user.type(input(), `${text}{Enter}`);
    return utils;
  };

  it('jumps to a chapter:verse reference (four arguments)', async () => {
    const { onPick } = await submit('John 3:16');
    expect(onPick).toHaveBeenCalledWith(43, 3, 16, undefined);
  });

  it('submits through the Go button too', async () => {
    const user = userEvent.setup();
    const { onPick } = setup();
    await user.type(input(), 'John 3:16');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onPick).toHaveBeenCalledWith(43, 3, 16, undefined);
  });

  it('accepts a verse range in the default extended syntax', async () => {
    const { onPick } = await submit('John 3:16-18');
    expect(onPick).toHaveBeenCalledWith(43, 3, 16, 18);
  });

  it('treats "Jude 5" as verse 5 of chapter 1 in extended syntax', async () => {
    const { onPick } = await submit('Jude 5');
    expect(onPick).toHaveBeenCalledWith(65, 1, 5, undefined);
  });

  it('treats "Jude 5" as chapter 5 in basic syntax (desktop behaviour kept as an option)', async () => {
    const { onPick } = await submit('Jude 5', { referenceSyntax: 'basic' });
    expect(onPick).toHaveBeenCalledWith(65, 5, undefined, undefined);
  });

  it('does not read a verse range in basic syntax', async () => {
    const { onPick } = await submit('John 3:16-18', { referenceSyntax: 'basic', search: { onSearch: vi.fn(), results: () => null } });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('lands on the first chapter of a chapter range', async () => {
    const { onPick } = await submit('John 3-5');
    expect(onPick).toHaveBeenCalledWith(43, 3, undefined, undefined);
  });

  it('opens chapter 1 for a bare book name, and understands partial names, aliases and roman numerals', async () => {
    const first = await submit('Genesis');
    expect(first.onPick).toHaveBeenCalledWith(1, 1, undefined, undefined);
    first.unmount();
    const second = await submit('mat 5:3');
    expect(second.onPick).toHaveBeenCalledWith(40, 5, 3, undefined);
    second.unmount();
    const third = await submit('jn 3', { bookAliases: { jn: 43 } });
    expect(third.onPick).toHaveBeenCalledWith(43, 3, undefined, undefined);
    third.unmount();
    const fourth = await submit('i cor 13');
    expect(fourth.onPick).toHaveBeenCalledWith(46, 13, undefined, undefined);
  });
});

describe('BookChapterPicker: search', () => {
  const searchProps = () => {
    const onSearch = vi.fn();
    const results = vi.fn((q: string) => <div data-testid="results">results for {q}</div>);
    return { onSearch, results, props: { search: { onSearch, results } } };
  };

  it('offers a search once non-reference text is typed, and not before', async () => {
    const user = userEvent.setup();
    const { props } = searchProps();
    setup(props);
    expect(screen.queryByRole('button', { name: /search for/i })).not.toBeInTheDocument();
    await user.type(input(), 'love');
    expect(screen.getByRole('button', { name: 'Search for "love"' })).toBeInTheDocument();
  });

  it('does not offer a search while a digit is present (still looks like a reference)', async () => {
    const user = userEvent.setup();
    setup(searchProps().props);
    await user.type(input(), 'John 3');
    expect(screen.queryByRole('button', { name: /search for/i })).not.toBeInTheDocument();
  });

  it('never offers a search without a search prop, and unrecognized text does nothing', async () => {
    const user = userEvent.setup();
    const { onPick } = setup();
    await user.type(input(), 'love{Enter}');
    expect(screen.queryByRole('button', { name: /search for/i })).not.toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('runs the search from the offer link, hides the book list and shows the app results', async () => {
    const user = userEvent.setup();
    const { onSearch, props } = searchProps();
    setup(props);
    await user.type(input(), 'love');
    await user.click(screen.getByRole('button', { name: 'Search for "love"' }));
    expect(onSearch).toHaveBeenCalledWith('love');
    expect(screen.getByTestId('results')).toHaveTextContent('results for love');
    expect(screen.queryByRole('button', { name: 'Genesis' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /search for/i })).not.toBeInTheDocument();
  });

  it('falls back to a search on Enter when the text is not a recognized reference', async () => {
    const user = userEvent.setup();
    const { onSearch, props } = searchProps();
    setup(props);
    await user.type(input(), 'shepherd psalm{Enter}');
    expect(onSearch).toHaveBeenCalledWith('shepherd psalm');
    expect(screen.getByTestId('results')).toHaveTextContent('results for shepherd psalm');
  });

  it('leaves search mode when the input is edited again', async () => {
    const user = userEvent.setup();
    setup(searchProps().props);
    await user.type(input(), 'love{Enter}');
    expect(screen.getByTestId('results')).toBeInTheDocument();
    await user.clear(input());
    expect(screen.queryByTestId('results')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Genesis' })).toBeInTheDocument();
  });

  it('a passage reference wins over search', async () => {
    const user = userEvent.setup();
    const { onSearch, props } = searchProps();
    const { onPick } = setup(props);
    await user.type(input(), 'John 3:16{Enter}');
    expect(onPick).toHaveBeenCalled();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('works when the parent re-renders with fresh callbacks', async () => {
    const user = userEvent.setup();
    function Host() {
      const [n, setN] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setN(n + 1)}>rerender {n}</button>
          <BookChapterPicker bookName={bookName} onPick={vi.fn()} labels={{ title: `T${n}` }} />
        </>
      );
    }
    render(<Host />);
    await user.type(input(), 'jo');
    await user.click(screen.getByRole('button', { name: /rerender/ }));
    expect(screen.getByRole('heading', { name: 'T1' })).toBeInTheDocument();
    expect(input()).toHaveValue('jo');
  });
});
