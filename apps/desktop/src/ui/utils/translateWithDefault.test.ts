import { describe, it, expect, vi } from 'vitest';
import { translateWithDefault } from './translateWithDefault';

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
