import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCatalogRefresh, REFRESH_DONE_VISIBLE_MS } from './useCatalogRefresh';

afterEach(() => vi.useRealTimers());

describe('useCatalogRefresh', () => {
  it('goes idle -> busy -> done -> idle', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const refresh = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const { result } = renderHook(() => useCatalogRefresh(refresh, () => null));
    expect(result.current.status).toBe('idle');

    let p!: Promise<void>;
    act(() => { p = result.current.run(); });
    expect(result.current.status).toBe('busy');

    await act(async () => { resolve(); await p; });
    expect(result.current.status).toBe('done');

    act(() => { vi.advanceTimersByTime(REFRESH_DONE_VISIBLE_MS + 1); });
    expect(result.current.status).toBe('idle');
  });

  it('ignores a second click while busy', async () => {
    let resolve!: () => void;
    const refresh = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const { result } = renderHook(() => useCatalogRefresh(refresh, () => null));
    let p!: Promise<void>;
    act(() => { p = result.current.run(); void result.current.run(); });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); await p; });
  });

  it('reports error when the store recorded one', async () => {
    const { result } = renderHook(() => useCatalogRefresh(async () => {}, () => 'Network blocked'));
    await act(async () => { await result.current.run(); });
    expect(result.current.status).toBe('error');
  });

  it('reports error when refresh throws', async () => {
    const { result } = renderHook(() => useCatalogRefresh(async () => { throw new Error('x'); }, () => null));
    await act(async () => { await result.current.run(); });
    expect(result.current.status).toBe('error');
  });
});
