import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: { defaultValue?: string }) => (key === 'xrefGraph.hopper.retry' ? 'Reessayer' : o?.defaultValue ?? key),
    i18n: { language: 'en' },
  }),
}));

import { DEFAULT_XREF_HOPPER_LABELS, DEFAULT_XREF_WEB_LABELS, DEFAULT_XREF_ARCS_LABELS } from '@bible/ui';
import { useXrefGraphLabels } from './useXrefGraphLabels';

describe('useXrefGraphLabels', () => {
  it('covers every key of every view, falling back to English defaults', () => {
    const { result } = renderHook(() => useXrefGraphLabels());
    expect(Object.keys(result.current.hopper)).toEqual(Object.keys(DEFAULT_XREF_HOPPER_LABELS));
    expect(Object.keys(result.current.web)).toEqual(Object.keys(DEFAULT_XREF_WEB_LABELS));
    expect(Object.keys(result.current.arcs)).toEqual(Object.keys(DEFAULT_XREF_ARCS_LABELS));
    expect(result.current.hopper.hopTo).toBe('Hop to {ref}');
    expect(result.current.arcs.open).toBe('Open {chapter}');
  });

  it('uses translations when present', () => {
    const { result } = renderHook(() => useXrefGraphLabels());
    expect(result.current.hopper.retry).toBe('Reessayer');
  });
});
