import { describe, it, expect } from 'vitest';
import { onJustAdded, setJustAdded, takeJustAdded } from '../justAdded';

describe('justAdded', () => {
  it('keeps an addition until the page takes it, once', () => {
    setJustAdded({ passageId: 1, reference: 'John 3:16', outcome: 'added' as const });
    expect(takeJustAdded()).toEqual({ passageId: 1, reference: 'John 3:16', outcome: 'added' as const });
    expect(takeJustAdded()).toBeUndefined();
  });

  it('delivers to a mounted listener instead of keeping it', () => {
    const got: unknown[] = [];
    const off = onJustAdded((a) => got.push(a));
    setJustAdded({ passageId: 2, reference: 'Psalm 23', outcome: 'exists' as const });
    expect(got).toEqual([{ passageId: 2, reference: 'Psalm 23', outcome: 'exists' as const }]);
    expect(takeJustAdded()).toBeUndefined();
    off();
    setJustAdded({ passageId: 3, reference: 'x', outcome: 'revived' as const });
    expect(takeJustAdded()).toEqual({ passageId: 3, reference: 'x', outcome: 'revived' as const });
  });
});
