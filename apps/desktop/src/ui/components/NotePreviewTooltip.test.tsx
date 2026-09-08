/**
 * Tests for NotePreviewTooltip's positioning, now migrated onto the shared
 * `usePopupPosition` hook (see usePopupPosition.ts / usePopupPosition.test.tsx).
 *
 * Like usePopupPosition.test.tsx, these mock `window.innerWidth`/`innerHeight`
 * directly rather than `getBoundingClientRect()` - jsdom returns 0 for both
 * `getBoundingClientRect()` and `scrollHeight`, so the hook's post-mount
 * refinement never fires in this environment (a 0 measurement is treated as
 * "not laid out yet", not a genuinely empty popup) and the synchronous,
 * estimate-driven first-paint placement is exactly what's under test here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import NotePreviewTooltip from './NotePreviewTooltip';

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));

vi.mock('../services/notesAPI', () => ({
  getNotesForVerse: vi.fn().mockResolvedValue([]),
}));

/** Flushes the `getNotesForVerse` promise so its resolution (a state update) is act()-wrapped. */
async function flushNotesFetch() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
}

const DEFAULT_VIEWPORT = { width: 1024, height: 768 };

describe('NotePreviewTooltip', () => {
  afterEach(() => {
    setViewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });

  it('places the popup at the trigger point (offset below) when there is room', async () => {
    setViewport(1024, 768);
    render(
      <NotePreviewTooltip
        verseId={43003016}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />
    );
    await flushNotesFetch();

    const el = screen.getByTestId('note-preview-tooltip');
    expect(el.style.position).toBe('fixed');
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('120px'); // default offsetY = 20
  });

  it('renders near the right viewport edge without overflowing horizontally', async () => {
    setViewport(800, 600);
    render(
      <NotePreviewTooltip
        verseId={43003016}
        position={{ x: 780, y: 100 }}
        onClose={vi.fn()}
      />
    );
    await flushNotesFetch();

    const el = screen.getByTestId('note-preview-tooltip');
    const left = parseFloat(el.style.left);
    const width = parseFloat(el.style.width);
    // Popup must fully fit within the viewport width, padding included.
    expect(left + width).toBeLessThanOrEqual(800 - 16);
    // And it must actually have moved off the raw trigger x to make that fit.
    expect(left).toBeLessThan(780);
  });

  it('flips above the trigger when there is not enough space below', async () => {
    setViewport(800, 300);
    render(
      <NotePreviewTooltip
        verseId={43003016}
        position={{ x: 100, y: 280 }}
        onClose={vi.fn()}
      />
    );
    await flushNotesFetch();

    const el = screen.getByTestId('note-preview-tooltip');
    const top = parseFloat(el.style.top);
    // Flipped: sits above the trigger point instead of running off the bottom.
    expect(top).toBeLessThan(280);
    expect(top).toBeGreaterThanOrEqual(16); // still respects top padding
    // Height is constrained, not just repositioned.
    expect(el.style.maxHeight).not.toBe('');
    expect(parseFloat(el.style.maxHeight)).toBeGreaterThan(0);
  });

  it('clamps width on a narrow viewport', async () => {
    setViewport(280, 600);
    render(
      <NotePreviewTooltip
        verseId={43003016}
        position={{ x: 50, y: 50 }}
        onClose={vi.fn()}
      />
    );
    await flushNotesFetch();

    const el = screen.getByTestId('note-preview-tooltip');
    const width = parseFloat(el.style.width);
    expect(width).toBeLessThanOrEqual(280 - 16 * 2);
  });

  it('never renders outside the viewport regardless of trigger position', async () => {
    setViewport(1024, 768);
    render(
      <NotePreviewTooltip
        verseId={43003016}
        position={{ x: 1020, y: 760 }}
        onClose={vi.fn()}
      />
    );
    await flushNotesFetch();

    const el = screen.getByTestId('note-preview-tooltip');
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    const width = parseFloat(el.style.width);
    const maxHeight = parseFloat(el.style.maxHeight);

    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(1024);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + maxHeight).toBeLessThanOrEqual(768);
  });
});
