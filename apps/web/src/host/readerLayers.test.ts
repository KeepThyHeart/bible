import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LayerDecorations } from '@bible/core/browser';
import { publishReaderLayer, readerLayers, resetReaderLayers } from './readerLayers';

const L = (id: string) => ({ layerId: id, decorations: [] }) as unknown as LayerDecorations;

beforeEach(() => resetReaderLayers());

describe('reader layers', () => {
  it('keeps layers per tab, ordered by source order, and withdraws them', () => {
    const a = L('a');
    const b = L('b');
    publishReaderLayer('t1', 'second', 20, b);
    publishReaderLayer('t1', 'first', 10, a);
    publishReaderLayer('t2', 'first', 10, L('c'));
    expect(readerLayers('t1')).toEqual([a, b]);
    publishReaderLayer('t1', 'first', 10, null);
    expect(readerLayers('t1')).toEqual([b]);
    publishReaderLayer('t1', 'second', 20, null);
    expect(readerLayers('t1')).toEqual([]);
    expect(readerLayers('t2')).toHaveLength(1);
  });

  it('returns a stable array until something changes, and does not notify for a repeat', () => {
    const a = L('a');
    publishReaderLayer('t', 's', 10, a);
    const first = readerLayers('t');
    expect(readerLayers('t')).toBe(first);
    publishReaderLayer('t', 's', 10, a);
    expect(readerLayers('t')).toBe(first);
    publishReaderLayer('t', 'gone', 10, null); // withdrawing what was never published is a no-op
    expect(readerLayers('t')).toBe(first);
  });

  it('withdraws nothing from an unknown tab', () => {
    expect(readerLayers('nope')).toEqual([]);
    const fn = vi.fn();
    publishReaderLayer('nope', 'x', 1, null);
    expect(fn).not.toHaveBeenCalled();
  });
});
