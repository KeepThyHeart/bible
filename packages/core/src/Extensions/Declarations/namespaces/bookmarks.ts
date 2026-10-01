/**
 * `api.bookmarks` - the user's bookmarks and bookmark folders.
 */

import type { IBookmarksApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const bookmarksNamespace = defineApiNamespace<IBookmarksApi>()({
  name: 'bookmarks',
  description: "Read and write the user's bookmarks.",
  since: '0.1.0',
  permissions: [
    {
      id: 'bookmarks:read',
      grant: 'prompt',
      consent: { key: 'extensionConsent.permission.bookmarksRead', text: 'Read your bookmarks.' },
      since: '0.1.0',
    },
    {
      id: 'bookmarks:write',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.bookmarksWrite',
        text: 'Create and remove your bookmarks.',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    list: { permission: 'bookmarks:read', fake: fakeReturns([]) },
    add: { permission: 'bookmarks:write', fake: fakeReturns({ id: 'mock-bm', verseId: 0, createdAt: 0 }) },
    remove: { permission: 'bookmarks:write' },
    listCollections: { permission: 'bookmarks:read', fake: fakeReturns([]) },
    createCollection: {
      permission: 'bookmarks:write',
      fake: fakeReturns({ id: 'mock-col', name: '', count: 0, createdAt: 0 }),
    },
  },
});
