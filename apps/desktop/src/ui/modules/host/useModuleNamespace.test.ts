import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const loadNamespace = vi.fn();
let i18n: { loadNamespace?: typeof loadNamespace } | undefined;
vi.mock('../../contexts/useI18n', () => ({ useI18n: () => ({ i18n }) }));

import { useModuleNamespace } from './useModuleNamespace';

describe('useModuleNamespace', () => {
  it('is ready at once when there is no loader', () => {
    i18n = {};
    expect(renderHook(() => useModuleNamespace('fx-none')).result.current).toBe(true);
  });

  it('is not ready until the namespace has loaded, then stays ready without reloading', async () => {
    let finish!: () => void;
    loadNamespace.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    i18n = { loadNamespace };
    const first = renderHook(() => useModuleNamespace('fx-slow'));
    expect(first.result.current).toBe(false);
    finish();
    await waitFor(() => expect(first.result.current).toBe(true));
    loadNamespace.mockClear();
    expect(renderHook(() => useModuleNamespace('fx-slow')).result.current).toBe(true);
    expect(loadNamespace).not.toHaveBeenCalled();
  });

  it('becomes ready even when the load fails', async () => {
    loadNamespace.mockRejectedValue(new Error('missing'));
    i18n = { loadNamespace };
    const { result } = renderHook(() => useModuleNamespace('fx-bad'));
    await waitFor(() => expect(result.current).toBe(true));
  });
});
