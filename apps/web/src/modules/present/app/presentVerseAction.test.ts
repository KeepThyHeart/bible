import { describe, it, expect, vi } from 'vitest';

const show = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../stores/presentStore', () => ({ presentStore: { show } }));

import { presentVerseHandler } from './presentVerseAction';

describe('presentVerseHandler', () => {
  it('shows the verse as a passage item at its verse index, in the acted-on module', async () => {
    await presentVerseHandler.run({ verseId: 43003016, verseIds: [43003016], module: 'KJV', surface: 'reader' });
    expect(show).toHaveBeenCalledWith({ kind: 'passage', module: 'KJV', book: 43, chapter: 3 }, 16);
  });
});
