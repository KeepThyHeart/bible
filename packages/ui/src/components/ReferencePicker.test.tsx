import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReferencePicker } from './ReferencePicker';
import type { ReferencePickerProps } from './ReferencePicker';

function setup(props: ReferencePickerProps = {}) {
  const onChange = vi.fn();
  const onInputChange = vi.fn();
  const utils = render(<ReferencePicker id="rp" onChange={onChange} onInputChange={onInputChange} {...props} />);
  const input = screen.getByRole('combobox') as HTMLInputElement;
  return { onChange, onInputChange, input, user: userEvent.setup(), ...utils };
}

describe('ReferencePicker', () => {
  it('renders a collapsed combobox with an accessible name', () => {
    const { input } = setup();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(screen.getByLabelText('Bible reference')).toBe(input);
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('opens the listbox with book suggestions while typing', async () => {
    const { input, user } = setup();
    await user.type(input, 'Jo');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', 'rp-listbox');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Joshua', 'Job', 'Joel', 'Jonah', 'John', '1 John', '2 John', '3 John']);
    expect(screen.getByRole('status')).toHaveTextContent('8 suggestions');
  });

  it('ArrowDown highlights the first option; Enter fills the book and does not commit', async () => {
    const { input, onChange, user } = setup();
    await user.type(input, 'Jo');
    await user.keyboard('{ArrowDown}');
    const first = screen.getAllByRole('option')[0];
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(input.value).toBe('Joshua ');
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('ArrowUp wraps to the last option and ArrowDown wraps back', async () => {
    const { input, user } = setup();
    await user.type(input, 'Jo');
    await user.keyboard('{ArrowUp}');
    const options = screen.getAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', options[options.length - 1].id);
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
  });

  it('commits a typed reference on Enter, once, with the value', async () => {
    const { input, onChange, user } = setup();
    await user.type(input, 'John 3:16');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ verseId: 43003016, ref: 'John 3:16' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('reports typed text through onInputChange', async () => {
    const { input, onInputChange, user } = setup();
    await user.type(input, 'Jo');
    expect(onInputChange).toHaveBeenLastCalledWith('Jo');
  });

  it('marks invalid input and announces it', async () => {
    const { input, onChange, user } = setup();
    await user.type(input, 'John 22:1');
    await user.keyboard('{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Not a valid reference');
    expect(onChange).not.toHaveBeenCalled();
    await user.type(input, '9');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('Escape closes the listbox, then clears the input', async () => {
    const { input, user } = setup();
    await user.type(input, 'Jo');
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input.value).toBe('Jo');
    await user.keyboard('{Escape}');
    expect(input.value).toBe('');
  });

  it('Tab closes the listbox without committing', async () => {
    const { input, onChange, user } = setup();
    await user.type(input, 'John 3:16');
    await user.tab();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the reference as the single option and commits it on click', async () => {
    const { input, onChange, user } = setup();
    await user.type(input, 'John 3:16-18');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('John 3:16-18');
    await user.click(options[0]);
    expect(onChange).toHaveBeenCalledWith({ verseId: 43003016, endVerseId: 43003018, ref: 'John 3:16-18' });
  });

  it('clicking a book option fills the text and keeps focus in the input', async () => {
    const { input, onChange, user } = setup();
    await user.type(input, 'Jo');
    await user.click(screen.getByRole('option', { name: 'John' }));
    expect(input.value).toBe('John ');
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
  });

  it('Alt+ArrowDown opens a closed list without moving the highlight', async () => {
    const { input, user } = setup();
    await user.type(input, 'Jo');
    await user.keyboard('{Escape}');
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('honours maxSuggestions, noRanges and noWholeChapter', async () => {
    const { input, onChange, user } = setup({ maxSuggestions: 3, noRanges: true, noWholeChapter: true });
    await user.type(input, 'Jo');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await user.clear(input);
    await user.type(input, 'John 3:16-18');
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, 'John 3');
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is controllable through value', async () => {
    const { input, rerender } = setup({ value: 'Jo' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Joh' } });
    expect(input.value).toBe('Jo'); // controlled: parent decides
    rerender(<ReferencePicker id="rp" value="John 3:16" />);
    expect(input.value).toBe('John 3:16');
  });

  it('localizes suggestions and the committed ref', async () => {
    const { input, onChange, user } = setup({ locale: 'es' });
    await user.type(input, 'Juan 3:16');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith({ verseId: 43003016, ref: 'Juan 3:16' });
  });

  it('takes its direction from the locale; an explicit dir wins', () => {
    const { container, rerender } = render(<ReferencePicker id="a" locale="ar" />);
    expect(container.querySelector('.kth-combobox')).toHaveAttribute('dir', 'rtl');
    rerender(<ReferencePicker id="a" locale="ar" dir="ltr" />);
    expect(container.querySelector('.kth-combobox')).toHaveAttribute('dir', 'ltr');
  });

  it('renders labels as text, never as HTML', () => {
    const { container } = render(<ReferencePicker labels={{ label: '<img src=x onerror=alert(1)>' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('label')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('shows the label when asked', () => {
    const { container } = render(<ReferencePicker showLabel />);
    expect(container.querySelector('label')).not.toHaveClass('kth-visually-hidden');
  });

  it('keeps ids distinct between two pickers', () => {
    render(
      <>
        <ReferencePicker id="one" />
        <ReferencePicker id="two" />
      </>,
    );
    const [a, b] = screen.getAllByRole('combobox');
    expect(a.getAttribute('aria-controls')).toBe('one-listbox');
    expect(b.getAttribute('aria-controls')).toBe('two-listbox');
    expect(within(document.body).getAllByRole('listbox', { hidden: true })).toHaveLength(2);
  });

  it('is disabled when asked', () => {
    setup({ disabled: true });
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
