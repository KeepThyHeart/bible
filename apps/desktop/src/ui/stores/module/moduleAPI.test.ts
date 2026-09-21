import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the search API
const buildIndexMock = vi.fn();

vi.mock('../../services/electronAPI', () => ({
  searchAPI: {
    buildIndex: (...args: unknown[]) => buildIndexMock(...args),
  },
}));

import { moduleAPI } from './moduleAPI';

describe('moduleAPI', () => {
  beforeEach(() => {
    buildIndexMock.mockReset();
  });

  describe('reindexModule', () => {
    it('calls buildIndex with a single module abbreviation', async () => {
      buildIndexMock.mockResolvedValue(undefined);

      await moduleAPI.reindexModule('ESV');

      expect(buildIndexMock).toHaveBeenCalledWith(['ESV'], undefined);
    });

    it('passes onProgress callback to buildIndex', async () => {
      const onProgress = vi.fn();
      buildIndexMock.mockResolvedValue(undefined);

      await moduleAPI.reindexModule('KJV', onProgress);

      expect(buildIndexMock).toHaveBeenCalledWith(['KJV'], onProgress);
    });

    it('returns the result from buildIndex', async () => {
      const expectedResult = { indexed: true };
      buildIndexMock.mockResolvedValue(expectedResult);

      const result = await moduleAPI.reindexModule('ESV');

      expect(result).toEqual(expectedResult);
    });

    it('propagates errors from buildIndex', async () => {
      const error = new Error('Index failed');
      buildIndexMock.mockRejectedValue(error);

      await expect(moduleAPI.reindexModule('ESV')).rejects.toThrow('Index failed');
    });
  });
});
