import { describe, it, expect } from 'vitest';
import { formatBytesLocalized } from './formatBytes';

const loc = { formatNumber: (n: number, o?: { minimumFractionDigits?: number }) => (o?.minimumFractionDigits ? n.toFixed(1) : String(n)) };

describe('formatBytesLocalized', () => {
  it('steps B, KB, MB and GB', () => {
    expect(formatBytesLocalized(0, loc)).toBe('0 B');
    expect(formatBytesLocalized(512, loc)).toBe('512 B');
    expect(formatBytesLocalized(2048, loc)).toBe('2.0 KB');
    expect(formatBytesLocalized(5 * 1024 * 1024, loc)).toBe('5.0 MB');
    expect(formatBytesLocalized(2147 * 1_000_000, loc)).toBe('2.0 GB');
  });
  it('treats invalid input as 0', () => {
    expect(formatBytesLocalized(Number.NaN, loc)).toBe('0 B');
    expect(formatBytesLocalized(-5, loc)).toBe('0 B');
  });
});
