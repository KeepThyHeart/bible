import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eventBus } from '../events/eventBus';

describe('EventBus', () => {
  beforeEach(() => {
    eventBus.clear();
  });

  it('subscribes and emits events with payload', () => {
    const handler = vi.fn();
    eventBus.on('bible:verse-selected', handler);
    const payload = { verseId: 43003016, book: 43, chapter: 3, verse: 16 };
    eventBus.emit('bible:verse-selected', payload);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('multiple subscribers receive the same event', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();
    eventBus.on('pane:show', handler1);
    eventBus.on('pane:show', handler2);
    eventBus.on('pane:show', handler3);
    eventBus.emit('pane:show', { paneId: 'commentary' });
    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
    expect(handler3).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops receiving events', () => {
    const handler = vi.fn();
    const unsub = eventBus.on('strongs:open', handler);
    eventBus.emit('strongs:open', { strongsNumber: 'G25' });
    expect(handler).toHaveBeenCalledOnce();

    unsub();
    eventBus.emit('strongs:open', { strongsNumber: 'G26' });
    expect(handler).toHaveBeenCalledOnce(); // still 1, not 2
  });

  it('different events are isolated', () => {
    const verseHandler = vi.fn();
    const paneHandler = vi.fn();
    eventBus.on('bible:verse-selected', verseHandler);
    eventBus.on('pane:show', paneHandler);

    eventBus.emit('pane:show', { paneId: 'dictionary' });
    expect(verseHandler).not.toHaveBeenCalled();
    expect(paneHandler).toHaveBeenCalledOnce();
  });

  it('void events work correctly (pane:expand)', () => {
    const handler = vi.fn();
    eventBus.on('pane:expand', handler);
    eventBus.emit('pane:expand');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('error in one handler does not break other handlers', () => {
    const errorHandler = vi.fn(() => {
      throw new Error('handler exploded');
    });
    const goodHandler = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    eventBus.on('pane:show', errorHandler);
    eventBus.on('pane:show', goodHandler);

    expect(() => eventBus.emit('pane:show', { paneId: 'notes' })).not.toThrow();
    expect(errorHandler).toHaveBeenCalledOnce();
    expect(goodHandler).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('clear() removes all handlers', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    eventBus.on('bible:verse-selected', handler1);
    eventBus.on('pane:show', handler2);

    eventBus.clear();

    eventBus.emit('bible:verse-selected', { verseId: 1001001, book: 1, chapter: 1, verse: 1 });
    eventBus.emit('pane:show', { paneId: 'dict' });
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('emitting with no subscribers does not throw', () => {
    expect(() => {
      eventBus.emit('bible:verse-selected', { verseId: 1001001, book: 1, chapter: 1, verse: 1 });
    }).not.toThrow();
    expect(() => {
      eventBus.emit('pane:expand');
    }).not.toThrow();
  });

  it('handler receives the correct payload data', () => {
    const handler = vi.fn();
    eventBus.on('study:load-verse', handler);
    const payload = { verseId: 66022021, book: 66, chapter: 22, verse: 21 };
    eventBus.emit('study:load-verse', payload);
    expect(handler).toHaveBeenCalledWith(payload);
    expect(handler.mock.calls[0][0].verseId).toBe(66022021);
    expect(handler.mock.calls[0][0].book).toBe(66);
  });

  it('multiple unsubscribes are safe (no error on double-unsub)', () => {
    const handler = vi.fn();
    const unsub = eventBus.on('pane:show', handler);
    unsub();
    expect(() => unsub()).not.toThrow();
    expect(() => unsub()).not.toThrow();
  });

  it('re-subscribing after unsubscribe works', () => {
    const handler = vi.fn();
    const unsub = eventBus.on('strongs:open', handler);
    unsub();

    eventBus.emit('strongs:open', { strongsNumber: 'H100' });
    expect(handler).not.toHaveBeenCalled();

    eventBus.on('strongs:open', handler);
    eventBus.emit('strongs:open', { strongsNumber: 'H200' });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ strongsNumber: 'H200' });
  });

  it('on() returns a unique unsubscribe function per subscription', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const unsub1 = eventBus.on('pane:show', handler1);
    const unsub2 = eventBus.on('pane:show', handler2);

    unsub1();
    eventBus.emit('pane:show', { paneId: 'search' });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledOnce();

    unsub2();
  });

  it('payload with optional footnotes field is passed through', () => {
    const handler = vi.fn();
    eventBus.on('bible:verse-selected', handler);
    const payload = {
      verseId: 43003016,
      book: 43,
      chapter: 3,
      verse: 16,
      footnotes: [{ marker: 'a', text: 'Some manuscripts add...' }],
    };
    eventBus.emit('bible:verse-selected', payload as Parameters<typeof handler>[0]);
    expect(handler.mock.calls[0][0].footnotes).toHaveLength(1);
    expect(handler.mock.calls[0][0].footnotes[0].marker).toBe('a');
  });

  it('commentary:load-chapter event works with correct payload', () => {
    const handler = vi.fn();
    eventBus.on('commentary:load-chapter', handler);
    eventBus.emit('commentary:load-chapter', { book: 1, chapter: 1 });
    expect(handler).toHaveBeenCalledWith({ book: 1, chapter: 1 });
  });
});
