import { describe, it, expect } from 'vitest';
import { describeReferenceProblem } from './referenceProblem';

describe('describeReferenceProblem (B-039/B-040)', () => {
  it.each(['Ps 151', 'Rev 23', 'John 3:999', 'Gen 0:1', '1 Jn'])('flags %s', (q) => {
    expect(describeReferenceProblem(q)).toBeDefined();
  });
  it.each(['Ps 150', 'Rev 22:21', 'John 3:16', 'John', 'love one another', 'John 3:16-18'])('lets %s through', (q) => {
    expect(describeReferenceProblem(q)).toBeUndefined();
  });
  it('names the limit', () => {
    expect(describeReferenceProblem('Ps 151')?.params).toMatchObject({ count: 150 });
    expect(describeReferenceProblem('John 3:999')?.params).toMatchObject({ count: 36 });
  });
});
