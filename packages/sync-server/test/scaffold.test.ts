import { describe, expect, it } from 'vitest';
import { createSyncServer } from '../src';

describe('@bible/sync-server scaffold', () => {
  it('exports createSyncServer', () => {
    expect(typeof createSyncServer).toBe('function');
  });
});
