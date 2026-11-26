import { describe, it, expect } from 'vitest';
import { exportFileName } from './noteDocument';

describe('exportFileName', () => {
  it('writes a colon as a dot so verse references stay readable', () => {
    expect(exportFileName('Romans 7:24-8:4; 1 Corinthians 15:50-58; Isaiah 53'))
      .toBe('Romans 7.24-8.4; 1 Corinthians 15.50-58; Isaiah 53');
  });

  it('keeps replacing the other unsafe characters with an underscore', () => {
    expect(exportFileName('a<b>"c/d\\e|f?g*h')).toBe('a_b__c_d_e_f_g_h');
  });

  it('falls back to "note" for an empty title', () => {
    expect(exportFileName('')).toBe('note');
  });
});
