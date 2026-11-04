import { describe, it, expect } from 'vitest';
import { plainTextKeepingDivineName } from './divineName';

describe('plainTextKeepingDivineName (B-167)', () => {
  it('strips markup but keeps the divine-name span', () => {
    expect(plainTextKeepingDivineName('<p>In the mount of the <span class="divine-name">Lord</span> it <em>shall</em> be seen.</p>'))
      .toBe('In the mount of the <span class="divine-name">Lord</span> it shall be seen.');
  });
  it('drops other spans without unbalancing the kept ones', () => {
    expect(plainTextKeepingDivineName('<span class="woj">Thus <span class="divine-name">Lord</span> said</span>'))
      .toBe('Thus <span class="divine-name">Lord</span> said');
  });
  it('is plain for text without a divine name', () => {
    expect(plainTextKeepingDivineName('Text  1')).toBe('Text 1');
  });
});
