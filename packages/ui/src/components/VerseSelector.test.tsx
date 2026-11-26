import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VerseSelector } from './VerseSelector';
import type { VerseSelectorProps } from './VerseSelector';
import { mountVerseSelector } from './mountVerseSelector';

function setup(props: Partial<VerseSelectorProps> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const utils = render(<VerseSelector id="vs" onChange={onChange} onSubmit={onSubmit} {...props} />);
  const sel = (name: string) => screen.getByLabelText(name) as HTMLSelectElement;
  const input = () => screen.getByRole('combobox', { name: 'Bible reference' }) as HTMLInputElement;
  return { onChange, onSubmit, sel, input, user: userEvent.setup(), ...utils };
}

describe('VerseSelector', () => {
  it('seeds from initialReference and reports it once', () => {
    const { onChange, sel, input } = setup({ initialReference: 'John 3:16' });
    expect(input().value).toBe('John 3:16');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ verseId: 43003016, ref: 'John 3:16' });
    expect(sel('Book').value).toBe('43');
    expect(sel('Chapter').value).toBe('3');
    expect(sel('Verse').value).toBe('16');
    expect(sel('To verse').value).toBe('');
  });

  it('a range seed fills "to"; a whole chapter seed selects All and disables "to"', () => {
    const a = setup({ initialReference: 'John 3:16-18' });
    expect(a.sel('To verse').value).toBe('3:18');
    expect(a.onChange).toHaveBeenCalledWith({ verseId: 43003016, endVerseId: 43003018, ref: 'John 3:16-18' });
    a.unmount();
    const b = setup({ initialReference: 'Psalm 23' });
    expect(b.sel('Verse').value).toBe('0');
    expect(b.sel('To verse')).toBeDisabled();
    expect(b.onChange).toHaveBeenCalledWith({ verseId: 19023001, ref: 'Psalms 23', wholeChapter: true });
  });

  it('typing commits live; Enter submits', async () => {
    const { onChange, onSubmit, input, sel, user } = setup();
    await user.type(input(), 'Romans 8:1-4');
    expect(onChange).toHaveBeenLastCalledWith({ verseId: 45008001, endVerseId: 45008004, ref: 'Romans 8:1-4' });
    expect(sel('To verse').value).toBe('8:4');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ verseId: 45008001, endVerseId: 45008004, ref: 'Romans 8:1-4' });
  });

  it('selects rewrite the text and report', async () => {
    const { onChange, sel, input, user } = setup({ initialReference: 'John 3:16' });
    await user.selectOptions(sel('To verse'), '3:18');
    expect(input().value).toBe('John 3:16-18');
    expect(onChange).toHaveBeenLastCalledWith({ verseId: 43003016, endVerseId: 43003018, ref: 'John 3:16-18' });
    await user.selectOptions(sel('Verse'), '0');
    expect(input().value).toBe('John 3');
    expect(onChange).toHaveBeenLastCalledWith({ verseId: 43003001, ref: 'John 3', wholeChapter: true });
    await user.selectOptions(sel('Chapter'), '4');
    expect(input().value).toBe('John 4');
    await user.selectOptions(sel('Book'), '45');
    expect(input().value).toBe('Romans 1');
  });

  it('crossChapter offers end-of-chapter entries; a cross-chapter range is built from them', async () => {
    const { onChange, sel, user } = setup({ initialReference: 'John 3:35' });
    const opts = Array.from(sel('To verse').options).map((o) => o.textContent);
    expect(opts).toContain('End of chapter 4');
    await user.selectOptions(sel('To verse'), '4:54');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ verseId: 43003035, endVerseId: 43004054 }));
  });

  it('crossChapter=false hides those entries and rejects a typed cross-chapter range', async () => {
    const { onChange, sel, input, user } = setup({ initialReference: 'John 3:35', crossChapter: false });
    expect(Array.from(sel('To verse').options).map((o) => o.textContent)).not.toContain('End of chapter 4');
    await user.clear(input());
    await user.type(input(), 'John 3:35-4:2');
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(document.querySelector('.kth-verse-selector__status')?.textContent).toMatch(/cannot span chapters/);
  });

  it('wholeChapter=false removes All and rejects "John 3"', async () => {
    const { sel, input, user, onChange } = setup({ initialReference: 'John 3:16', wholeChapter: false });
    expect(Array.from(sel('Verse').options).map((o) => o.textContent)).not.toContain('All');
    await user.clear(input());
    await user.type(input(), 'John 3');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('invalid text after a valid one reports null and a message', async () => {
    const { onChange, input, user } = setup({ initialReference: 'John 3:16' });
    await user.type(input(), 'x');
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getAllByRole('status').some((s) => s.textContent === 'Not a valid reference')).toBe(true);
  });

  it('re-seeds on a changed initialReference only', () => {
    const onChange = vi.fn();
    const { rerender } = render(<VerseSelector id="vs" initialReference="John 3:16" onChange={onChange} />);
    rerender(<VerseSelector id="vs" initialReference="John 3:16" onChange={onChange} />);
    expect(onChange).toHaveBeenCalledTimes(1);
    rerender(<VerseSelector id="vs" initialReference="Jude 5" onChange={onChange} />);
    expect((screen.getByRole('combobox', { name: 'Bible reference' }) as HTMLInputElement).value).toBe('Jude 5');
    expect(onChange).toHaveBeenLastCalledWith({ verseId: 65001005, ref: 'Jude 1:5' });
  });

  describe('preview', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it('debounces, passes a whole chapter as a range, caps and shows "and N more"', async () => {
      const lookup = vi.fn(async (_r: { verseId: number; endVerseId?: number }) =>
        Array.from({ length: 5 }, (_, i) => ({ verseId: 19023001 + i, text: `text ${i + 1}` })),
      );
      setup({ initialReference: 'Psalm 23', lookup, previewMaxVerses: 3 });
      expect(lookup).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup.mock.calls[0][0]).toEqual({ verseId: 19023001, endVerseId: 19023006 });
      await waitFor(() => expect(screen.getByText('text 3')).toBeInTheDocument());
      expect(screen.queryByText('text 4')).toBeNull();
      expect(screen.getByText('and 2 more')).toBeInTheDocument();
    });

    it('shows a message when the lookup has no text', async () => {
      setup({ initialReference: 'John 3:16', lookup: async () => null });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      await waitFor(() => expect(screen.getByText('No text available')).toBeInTheDocument());
    });

    it('renders no preview region without a lookup', () => {
      setup({ initialReference: 'John 3:16' });
      expect(document.querySelector('.kth-verse-selector__preview')).toBeNull();
    });
  });

  it('aborts the previous lookup when the selection changes (real timers)', async () => {
    const signals: AbortSignal[] = [];
    const lookup = vi.fn((_r: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<never>(() => undefined);
    });
    const { sel, user } = setup({ initialReference: 'John 3:16', lookup });
    await waitFor(() => expect(signals).toHaveLength(1), { timeout: 2000 });
    await user.selectOptions(sel('To verse'), '3:17');
    await waitFor(() => expect(signals[0].aborted).toBe(true));
    await waitFor(() => expect(signals).toHaveLength(2), { timeout: 2000 });
  });

  it('is a labelled group with labelled controls (a11y)', () => {
    setup({ initialReference: 'John 3:16', lookup: async () => null });
    expect(screen.getByRole('group', { name: 'Verse selector' })).toBeInTheDocument();
    for (const n of ['Book', 'Chapter', 'Verse', 'To verse', 'Bible reference']) expect(screen.getByLabelText(n)).toBeInTheDocument();
    expect(document.querySelector('blockquote[aria-live="polite"]')).not.toBeNull();
  });

  it('disabled disables every control', () => {
    const { sel, input } = setup({ initialReference: 'John 3:16', disabled: true });
    expect(input()).toBeDisabled();
    for (const n of ['Book', 'Chapter', 'Verse', 'To verse']) expect(sel(n)).toBeDisabled();
  });
});

describe('mountVerseSelector', () => {
  it('mounts, updates and disposes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onChange = vi.fn();
    const h = mountVerseSelector(host, { id: 'm', initialReference: 'John 3:16', onChange });
    await waitFor(() => expect(host.querySelector('input')?.value).toBe('John 3:16'));
    h.update({ initialReference: 'Jude 5' });
    await waitFor(() => expect(host.querySelector('input')?.value).toBe('Jude 5'));
    h.dispose();
    await waitFor(() => expect(host.querySelector('input')).toBeNull());
    host.remove();
  });
});
