import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';
import { DEFAULT_XREF_HOPPER_LABELS, DEFAULT_XREF_WEB_LABELS, DEFAULT_XREF_ARCS_LABELS, DEFAULT_XREF_COMPASS_LABELS } from '@bible/ui';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { useXrefGraphLabels, translateWithDefault } from './useXrefGraphLabels';

function wrapperFor(t: (key: string, params?: Record<string, unknown>) => string) {
  const services = {
    registry: {},
    whenContext: {},
    keybindings: {},
    i18n: {
      t,
      currentLocale: 'en',
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
    },
  } as unknown as AppServices;
  return ({ children }: { children: React.ReactNode }) => (
    <ContextProvider services={services}>{children}</ContextProvider>
  );
}

describe('translateWithDefault', () => {
  it('falls back to the English default when the key is missing', () => {
    expect(translateWithDefault((k) => `[${k}]`, 'a.b', 'Hop to {ref}')).toBe('Hop to {ref}');
  });

  it('passes every placeholder through as literal text', () => {
    const t = vi.fn((_k: string, p?: Record<string, unknown>) => `Saltar a ${p?.ref}`);
    expect(translateWithDefault(t, 'a.b', 'Hop to {ref}')).toBe('Saltar a {ref}');
    expect(t).toHaveBeenCalledWith('a.b', { ref: '{ref}' });
  });

  it('passes no params when the default has no placeholders', () => {
    const t = vi.fn(() => 'Volver');
    translateWithDefault(t, 'a.b', 'Back');
    expect(t).toHaveBeenCalledWith('a.b', undefined);
  });
});

describe('useXrefGraphLabels', () => {
  it('returns the English defaults when no catalog entries exist', () => {
    const { result } = renderHook(() => useXrefGraphLabels(), { wrapper: wrapperFor((k) => `[${k}]`) });
    expect(result.current.hopper).toEqual(DEFAULT_XREF_HOPPER_LABELS);
    expect(result.current.web).toEqual(DEFAULT_XREF_WEB_LABELS);
    expect(result.current.arcs).toEqual(DEFAULT_XREF_ARCS_LABELS);
    expect(result.current.compass).toEqual(DEFAULT_XREF_COMPASS_LABELS);
  });

  it('looks up xrefGraph.<view>.<label> for every label', () => {
    const t = vi.fn((k: string) => `T:${k}`);
    const { result } = renderHook(() => useXrefGraphLabels(), { wrapper: wrapperFor(t) });
    expect(result.current.hopper.back).toBe('T:xrefGraph.hopper.back');
    expect(result.current.web.retry).toBe('T:xrefGraph.web.retry');
    expect(result.current.arcs.reset).toBe('T:xrefGraph.arcs.reset');
    const keys = Object.keys(DEFAULT_XREF_HOPPER_LABELS).length
      + Object.keys(DEFAULT_XREF_WEB_LABELS).length
      + Object.keys(DEFAULT_XREF_ARCS_LABELS).length
      + Object.keys(DEFAULT_XREF_COMPASS_LABELS).length;
    expect(new Set(t.mock.calls.map((c) => c[0])).size).toBe(keys);
  });
});
