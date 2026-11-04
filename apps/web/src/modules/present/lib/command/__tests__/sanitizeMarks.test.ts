import { describe, it, expect } from 'vitest';
import { sanitizeMarks } from '../CommandSearchResults';

describe('sanitizeMarks (soak WP-04)', () => {
  it('keeps the server\'s <strong><u> match markup instead of showing it as text', () => {
    expect(sanitizeMarks('Noah found <strong><u>grace</u></strong> in')).toBe('Noah found <strong><u>grace</u></strong> in');
  });
  it('still escapes everything else', () => {
    expect(sanitizeMarks('<img src=x onerror=1><mark>a</mark> & b')).toBe('&lt;img src=x onerror=1&gt;<mark>a</mark> &amp; b');
  });
});
