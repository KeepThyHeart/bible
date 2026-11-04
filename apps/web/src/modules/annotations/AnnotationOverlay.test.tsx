import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string, o?: Record<string, string>) => (o?.reference ? `${key}:${o.reference}` : key), i18n: { language: 'en' } }),
}));

const store = vi.hoisted(() => ({
  setHighlight: vi.fn(),
  removeHighlights: vi.fn(),
  saveNote: vi.fn(),
  deleteNote: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('./instance', () => ({ annotationStore: store }));

import { AnnotationOverlay } from './AnnotationOverlay';
import { annotationUi } from './annotationUi';

const note = { id: 9, start: 5, end: 5, title: 'T', content: '<p>a &lt;b&gt;</p><p>second</p>', modified: 'm' };

beforeEach(() => {
  annotationUi.reset();
  for (const f of Object.values(store)) f.mockReset().mockResolvedValue(undefined);
  store.fetch.mockResolvedValue({ highlights: [], notes: [], bookmarks: [] });
});
afterEach(() => cleanup());

describe('colour popover', () => {
  const open = (hasHighlight: boolean) => {
    render(<AnnotationOverlay />);
    act(() => annotationUi.openHighlight({ moduleId: 7, start: 43003016, end: 43003017, color: hasHighlight ? '#B7E4C7' : null, hasHighlight }));
  };

  it('picking a swatch saves the highlight with its hex and closes', async () => {
    open(false);
    fireEvent.click(await screen.findByRole('radio', { name: 'annotations.colors.blue' }));
    expect(store.setHighlight).toHaveBeenCalledWith(7, 43003016, 43003017, '#B8DDF5');
    expect(annotationUi.popover).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows Remove only for an existing highlight and removes the range', async () => {
    open(false);
    await screen.findByRole('dialog');
    expect(screen.queryByText('annotations.highlight.remove')).toBeNull();
    cleanup();
    open(true);
    fireEvent.click(await screen.findByText('annotations.highlight.remove'));
    expect(store.removeHighlights).toHaveBeenCalledWith(7, 43003016, 43003017);
    expect(annotationUi.popover).toBeNull();
  });

  it('a failed save shows the error toast', async () => {
    store.setHighlight.mockRejectedValue(new Error('x'));
    open(false);
    fireEvent.click(await screen.findByRole('radio', { name: 'annotations.colors.red' }));
    expect((await screen.findByRole('status')).textContent).toBe('annotations.error');
  });

  it('Escape and an outside press close it', async () => {
    open(false);
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(annotationUi.popover).toBeNull();
    act(() => annotationUi.openHighlight({ moduleId: 7, start: 1, end: 1, color: null, hasHighlight: false }));
    await screen.findByRole('dialog');
    fireEvent.pointerDown(document.body);
    expect(annotationUi.popover).toBeNull();
  });
});

describe('note dialog', () => {
  it('starts empty for a new note, focuses the text, saves escaped HTML and closes', async () => {
    render(<AnnotationOverlay />);
    act(() => annotationUi.openNote({ start: 5, end: 6, reference: 'John 3:5-6', note: null }));
    const text = (await screen.findByLabelText('annotations.note.textLabel')) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(text));
    const save = screen.getByRole('button', { name: 'annotations.note.save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.queryByText('annotations.note.delete')).toBeNull();
    fireEvent.input(text, { target: { value: 'x <img src=x onerror=alert(1)> & y\nline2' } });
    fireEvent.input(screen.getByLabelText('annotations.note.titleLabel'), { target: { value: ' Title ' } });
    fireEvent.click(save);
    await waitFor(() => expect(annotationUi.note).toBeNull());
    expect(store.saveNote).toHaveBeenCalledWith({
      id: undefined, start: 5, end: 6, title: 'Title',
      content: '<p>x &lt;img src=x onerror=alert(1)&gt; &amp; y</p><p>line2</p>',
    });
  });

  it('shows an existing note as plain text (never as markup)', async () => {
    const evil = { ...note, content: '<p>hi</p><script>alert(1)</script><img src=x onerror=alert(1)>' };
    const { container } = render(<AnnotationOverlay />);
    act(() => annotationUi.openNote({ start: 5, end: 5, reference: 'r', note: evil }));
    const text = (await screen.findByLabelText('annotations.note.textLabel')) as HTMLTextAreaElement;
    expect(text.value).toContain('hi');
    expect(container.querySelector('script, img')).toBeNull();
  });

  it('deleting asks to confirm first, then deletes the note', async () => {
    render(<AnnotationOverlay />);
    act(() => annotationUi.openNote({ start: 5, end: 5, reference: 'r', note }));
    const text = (await screen.findByLabelText('annotations.note.textLabel')) as HTMLTextAreaElement;
    expect(text.value).toBe('a <b>\nsecond');
    fireEvent.click(screen.getByText('annotations.note.delete'));
    expect(store.deleteNote).not.toHaveBeenCalled();
    expect(screen.getByText('annotations.note.confirmDelete')).toBeTruthy();
    fireEvent.click(screen.getByText('annotations.note.deleteConfirm'));
    await waitFor(() => expect(store.deleteNote).toHaveBeenCalledWith(9));
    await waitFor(() => expect(annotationUi.note).toBeNull());
  });

  it('keeps the dialog open with an alert when saving fails; Escape and the close button close it', async () => {
    store.saveNote.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<AnnotationOverlay />);
    act(() => annotationUi.openNote({ start: 5, end: 5, reference: 'r', note }));
    await screen.findByLabelText('annotations.note.textLabel');
    fireEvent.click(screen.getByRole('button', { name: 'annotations.note.save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('annotations.error');
    expect(annotationUi.note).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(annotationUi.note).toBeNull();
  });

  it('a retry after a failed create reuses a note that did land (no duplicate)', async () => {
    store.saveNote.mockRejectedValueOnce(new Error('handoff')).mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    store.fetch.mockResolvedValue({ highlights: [], bookmarks: [], notes: [{ id: 33, start: 5, end: 5, title: null, content: '<p>hello</p>', modified: 'm' }] });
    render(<AnnotationOverlay />);
    act(() => annotationUi.openNote({ start: 5, end: 5, reference: 'r', note: null }));
    fireEvent.input(await screen.findByLabelText('annotations.note.textLabel'), { target: { value: 'hello' } });
    const save = screen.getByRole('button', { name: 'annotations.note.save' });
    fireEvent.click(save);
    await screen.findByRole('alert');
    fireEvent.click(save);
    await waitFor(() => expect(store.saveNote).toHaveBeenCalledTimes(2));
    expect(store.saveNote.mock.calls[1][0].id).toBe(33);
  });

  it('is marked modal with a labelled dialog role', async () => {
    render(<AnnotationOverlay />);
    act(() => annotationUi.openNote({ start: 5, end: 5, reference: 'John 3:5', note: null }));
    const dlg = await screen.findByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-label')).toBe('annotations.note.heading:John 3:5');
  });
});

describe('toast', () => {
  it('renders the bookmark toast as a polite status and clears after its time', async () => {
    vi.useFakeTimers();
    try {
      render(<AnnotationOverlay />);
      act(() => annotationUi.showToast('annotations.bookmark.added', 1000));
      const el = screen.getByRole('status');
      expect(el.textContent).toBe('annotations.bookmark.added');
      expect(el.getAttribute('aria-live')).toBe('polite');
      act(() => { vi.advanceTimersByTime(1100); });
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
