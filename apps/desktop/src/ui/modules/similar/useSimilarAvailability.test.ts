import { describe, it, expect, vi, beforeEach } from 'vitest';

const status = vi.hoisted(() => vi.fn());
vi.mock('./similarAPI', () => ({ similarAPI: { status } }));

import { useSimilarAvailability } from './useSimilarAvailability';
import { whenContextService } from '../../services/WhenContextService';

describe('useSimilarAvailability', () => {
  beforeEach(() => { useSimilarAvailability.setState({ available: false }); status.mockReset(); });

  it.each([
    [{ table: 'missing', live: false }, false],
    [{ table: 'missing', live: true }, true],
    [{ table: 'ready', live: false }, true],
    [{ table: 'available', live: false }, true],
    [{ table: 'downloading', live: false }, true],
  ])('%j -> %s', async (s, expected) => {
    status.mockResolvedValue(s);
    await useSimilarAvailability.getState().refresh();
    expect(useSimilarAvailability.getState().available).toBe(expected);
    expect(whenContextService.get('similarAvailable')).toBe(expected);
  });

  it('is unavailable when the status call fails', async () => {
    status.mockRejectedValue(new Error('x'));
    await useSimilarAvailability.getState().refresh();
    expect(useSimilarAvailability.getState().available).toBe(false);
  });
});
