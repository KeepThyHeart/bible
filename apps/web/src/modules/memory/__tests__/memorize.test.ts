import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AddVersesOutcome } from '@bible/memory/api';

const api = { addVerses: vi.fn() };
const openDialog = vi.hoisted(() => vi.fn());
const openApp = vi.hoisted(() => vi.fn(async () => ({ status: 'activated' })));
vi.mock('../webMemoryApi', () => ({ getWebMemoryApi: () => ({ api }) }));
vi.mock('../../../host/appHost', () => ({ openApp }));
vi.mock('../../../i18n', () => ({ default: { resolvedLanguage: 'en', language: 'en' } }));
vi.mock('@bible/memory/add-to-memory', () => ({ openAddToMemoryDialog: openDialog }));

import { memorizeHandler } from '../memorize';
import { takeJustAdded } from '../justAdded';

const ctx = { verseIds: [43003016], module: 'kjv' } as unknown as Parameters<typeof memorizeHandler.run>[0];

describe('memorizeHandler', () => {
  beforeEach(() => {
    openDialog.mockReset();
    openApp.mockClear();
    takeJustAdded();
  });

  it.each<AddVersesOutcome>(['added', 'revived', 'exists'])('hands the %s outcome from the dialog to the Memory page', async (outcome) => {
    openDialog.mockResolvedValueOnce({ passageId: 7, reference: 'John 3:16', outcome, collectionId: 2, listName: 'Romans' });
    await memorizeHandler.run(ctx);
    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({ api, verseIds: [43003016], module: 'kjv', locale: 'en' }));
    expect(takeJustAdded()).toEqual({ passageId: 7, reference: 'John 3:16', outcome });
    expect(openApp).toHaveBeenCalledWith('memory');
  });

  it('does nothing when the dialog is cancelled', async () => {
    openDialog.mockResolvedValueOnce(null);
    await memorizeHandler.run(ctx);
    expect(takeJustAdded()).toBeUndefined();
    expect(openApp).not.toHaveBeenCalled();
  });
});
