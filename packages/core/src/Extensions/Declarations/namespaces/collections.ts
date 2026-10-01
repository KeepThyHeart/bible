/**
 * `api.collections` - ordered passage collections. Introduces no permissions;
 * its methods are gated by the bookmarks permissions.
 */

import type { ICollectionsApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns } from '../defineApiNamespace';

const MOCK_COLLECTION = { id: 'mock-col', name: '', entryCount: 0, createdAt: 0 };
const MOCK_ENTRY = {
  id: 'mock-entry',
  collectionId: 'mock-col',
  verseIdStart: 0,
  verseIdEnd: 0,
  position: 0,
  createdAt: 0,
};

export const collectionsNamespace = defineApiNamespace<ICollectionsApi>()({
  name: 'collections',
  description: "Manage the user's ordered collections of passages.",
  since: '0.1.0',
  permissions: [],
  methods: {
    list: { permission: 'bookmarks:read', fake: fakeReturns([]) },
    create: { permission: 'bookmarks:write', fake: fakeReturns(MOCK_COLLECTION) },
    rename: { permission: 'bookmarks:write', fake: fakeReturns(MOCK_COLLECTION) },
    delete: { permission: 'bookmarks:write' },
    listPassages: { permission: 'bookmarks:read', fake: fakeReturns([]) },
    addPassage: { permission: 'bookmarks:write', fake: fakeReturns(MOCK_ENTRY) },
    removePassage: { permission: 'bookmarks:write' },
    move: { permission: 'bookmarks:write', fake: fakeReturns([]) },
    reorder: { permission: 'bookmarks:write', fake: fakeReturns([]) },
  },
});
