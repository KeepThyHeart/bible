import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServerProviders } from '../providers/ServerDataProvider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockJsonResponse(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('ServerDataProvider', () => {
  const providers = createServerProviders('http://localhost:3100');

  describe('bible', () => {
    it('getChapter calls correct endpoint', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ verses: [], hasInterlinearData: false }));
      await providers.bible.getChapter('KJV', 1, 1);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3100/api/bible/KJV/1/1');
    });

    it('getVerse calls correct endpoint', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ verse_id: 43003016 }));
      await providers.bible.getVerse('KJV', 43003016);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3100/api/bible/KJV/verse/43003016');
    });
  });

  describe('commentary', () => {
    it('getCommentary calls correct endpoint', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ entries: [] }));
      await providers.commentary.getCommentary('Barnes', 43, 3);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3100/api/commentary/Barnes/43/3');
    });
  });

  describe('search', () => {
    it('keywordSearch calls correct endpoint with params', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ results: [], total: 0 }));
      await providers.search.keywordSearch('love', ['KJV']);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/search/keyword?q=love&modules=KJV')
      );
    });

    it('semanticSearch calls correct endpoint', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ results: [], total: 0 }));
      await providers.search.semanticSearch('meaning of life');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/search/semantic?q=meaning+of+life')
      );
    });
  });

  describe('modules', () => {
    it('getAvailableModules calls correct endpoint', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse([]));
      await providers.modules.getAvailableModules();
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3100/api/modules');
    });

    it('getAvailableModules with type filter', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse([]));
      await providers.modules.getAvailableModules('bible');
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3100/api/modules?type=bible');
    });

    it('getBooks calls correct endpoint', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse([]));
      await providers.modules.getBooks();
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3100/api/books');
    });
  });

  describe('strongs', () => {
    it('getEntry calls correct endpoint', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ strongsNumber: 'G2316' }));
      await providers.strongs.getEntry('G2316');
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3100/api/strongs/G2316');
    });
  });

  describe('error handling', () => {
    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
      });

      await expect(providers.bible.getChapter('NONEXISTENT', 1, 1))
        .rejects.toThrow('API error 404');
    });
  });
});
