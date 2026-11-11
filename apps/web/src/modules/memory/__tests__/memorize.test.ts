import { describe, it, expect, vi } from 'vitest';
import type { AddVersesOutcome } from '@bible/memory/api';

const addVerses = vi.fn();
vi.mock('../webMemoryApi', () => ({ getWebMemoryApi: () => ({ api: { addVerses } }) }));
vi.mock('../../../host/appHost', () => ({ openApp: vi.fn(async () => ({ status: 'activated' })) }));

import { memorizeHandler } from '../memorize';
import { takeJustAdded } from '../justAdded';

describe('memorizeHandler', () => {
  it.each<AddVersesOutcome>(['added', 'revived', 'exists'])('hands the %s outcome to the Memory page', async (outcome) => {
    addVerses.mockResolvedValueOnce({ passageId: 7, reference: 'John 3:16', outcome });
    await memorizeHandler.run({ verseIds: [43003016], module: 'kjv' } as unknown as Parameters<typeof memorizeHandler.run>[0]);
    expect(takeJustAdded()).toEqual({ passageId: 7, reference: 'John 3:16', outcome });
  });
});
