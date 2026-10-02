import { describe, it, expect } from 'vitest';
import { parseWebPresets } from './webPresets';

describe('parseWebPresets', () => {
  it('maps starter packs and drops malformed entries', () => {
    const out = parseWebPresets([
      { pack_id: 'a', name: 'A', version: '2', module_ids: ['KJV', 7] },
      { pack_id: 'b', name: 'B', module_ids: [] },
      null,
      { name: 'x' },
    ]);
    expect(out).toEqual([{ id: 'a', name: 'A', version: '2', items: [{ kind: 'module', id: 'KJV' }] }]);
    expect(parseWebPresets(undefined)).toEqual([]);
  });
});
