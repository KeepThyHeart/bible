/**
 * Component tests for ResizeHandle.
 *
 * Pattern: Pure presentational component with imperative DOM event handling.
 * Tests verify rendering, mousedown behavior (cursor/user-select changes),
 * delta calculation via mousemove, and cleanup via mouseup.
 * No store or i18n dependencies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';

import { ResizeHandle } from './ResizeHandle';

describe('ResizeHandle', () => {
  beforeEach(() => {
    // Reset document.body styles that may leak between tests
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  afterEach(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  it('renders the outer resize-handle div', () => {
    const { container } = render(<ResizeHandle onResize={vi.fn()} />);
    expect(container.querySelector('.resize-handle')).toBeTruthy();
  });

  it('renders the inner resize-handle__line div', () => {
    const { container } = render(<ResizeHandle onResize={vi.fn()} />);
    expect(container.querySelector('.resize-handle__line')).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Mousedown
  // ---------------------------------------------------------------------------

  it('sets cursor to col-resize on mousedown', () => {
    const { container } = render(<ResizeHandle onResize={vi.fn()} />);
    fireEvent.mouseDown(container.querySelector('.resize-handle')!, { clientX: 100 });
    expect(document.body.style.cursor).toBe('col-resize');
  });

  it('sets userSelect to none on mousedown', () => {
    const { container } = render(<ResizeHandle onResize={vi.fn()} />);
    fireEvent.mouseDown(container.querySelector('.resize-handle')!, { clientX: 100 });
    expect(document.body.style.userSelect).toBe('none');
  });

  it('prevents default on mousedown to avoid text selection', () => {
    const { container } = render(<ResizeHandle onResize={vi.fn()} />);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 100 });
    container.querySelector('.resize-handle')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Mousemove — delta calculation
  // ---------------------------------------------------------------------------

  it('calls onResize with the correct delta on mousemove', () => {
    const onResize = vi.fn();
    const { container } = render(<ResizeHandle onResize={onResize} />);

    fireEvent.mouseDown(container.querySelector('.resize-handle')!, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 115 });

    expect(onResize).toHaveBeenCalledWith(15);
  });

  it('calls onResize with a negative delta when moving left', () => {
    const onResize = vi.fn();
    const { container } = render(<ResizeHandle onResize={onResize} />);

    fireEvent.mouseDown(container.querySelector('.resize-handle')!, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 180 });

    expect(onResize).toHaveBeenCalledWith(-20);
  });

  it('calls onResize multiple times for multiple mousemoves (incremental deltas)', () => {
    const onResize = vi.fn();
    const { container } = render(<ResizeHandle onResize={onResize} />);

    fireEvent.mouseDown(container.querySelector('.resize-handle')!, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 110 }); // delta = 10
    fireEvent.mouseMove(document, { clientX: 125 }); // delta = 15 (from 110)
    fireEvent.mouseMove(document, { clientX: 120 }); // delta = -5 (from 125)

    expect(onResize).toHaveBeenCalledTimes(3);
    expect(onResize).toHaveBeenNthCalledWith(1, 10);
    expect(onResize).toHaveBeenNthCalledWith(2, 15);
    expect(onResize).toHaveBeenNthCalledWith(3, -5);
  });

  it('does not call onResize when mousemove fires before mousedown', () => {
    const onResize = vi.fn();
    render(<ResizeHandle onResize={onResize} />);

    fireEvent.mouseMove(document, { clientX: 150 });

    expect(onResize).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Mouseup — cleanup
  // ---------------------------------------------------------------------------

  it('restores cursor to default on mouseup', () => {
    const { container } = render(<ResizeHandle onResize={vi.fn()} />);

    fireEvent.mouseDown(container.querySelector('.resize-handle')!, { clientX: 100 });
    expect(document.body.style.cursor).toBe('col-resize');

    fireEvent.mouseUp(document);
    expect(document.body.style.cursor).toBe('');
  });

  it('restores userSelect to default on mouseup', () => {
    const { container } = render(<ResizeHandle onResize={vi.fn()} />);

    fireEvent.mouseDown(container.querySelector('.resize-handle')!, { clientX: 100 });
    expect(document.body.style.userSelect).toBe('none');

    fireEvent.mouseUp(document);
    expect(document.body.style.userSelect).toBe('');
  });

  it('stops calling onResize after mouseup', () => {
    const onResize = vi.fn();
    const { container } = render(<ResizeHandle onResize={onResize} />);

    fireEvent.mouseDown(container.querySelector('.resize-handle')!, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 110 });
    fireEvent.mouseUp(document);

    // Reset mock and verify no more calls after mouseup
    onResize.mockClear();
    fireEvent.mouseMove(document, { clientX: 130 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it('allows a new drag session after a previous one ended', () => {
    const onResize = vi.fn();
    const { container } = render(<ResizeHandle onResize={onResize} />);
    const handle = container.querySelector('.resize-handle')!;

    // First drag
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 110 });
    fireEvent.mouseUp(document);

    // Second drag
    onResize.mockClear();
    fireEvent.mouseDown(handle, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 210 });

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(10);
  });

  // ---------------------------------------------------------------------------
  // Zero delta
  // ---------------------------------------------------------------------------

  it('calls onResize with 0 when mouse does not move', () => {
    const onResize = vi.fn();
    const { container } = render(<ResizeHandle onResize={onResize} />);

    fireEvent.mouseDown(container.querySelector('.resize-handle')!, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 100 });

    expect(onResize).toHaveBeenCalledWith(0);
  });
});
