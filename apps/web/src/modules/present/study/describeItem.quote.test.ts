import { describe, it, expect } from 'vitest';
import { describeItem } from './usePresenter';

describe('describeItem for quotes (soak WP-06)', () => {
  it('shows the words so announcements can be told apart', () => {
    expect(describeItem({ kind: 'quote', text: 'Welcome to church', attribution: 'Pastor Sam' }, 0)).toBe('“Welcome to church” — Pastor Sam');
    expect(describeItem({ kind: 'quote', text: 'Potluck after the service' }, 0)).toBe('“Potluck after the service”');
  });
  it('shortens a long quote', () => {
    const label = describeItem({ kind: 'quote', text: 'x'.repeat(100) }, 0)!;
    expect(label.length).toBeLessThan(50);
    expect(label).toContain('…');
  });
});
