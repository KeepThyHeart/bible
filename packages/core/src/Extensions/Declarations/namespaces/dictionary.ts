/**
 * `api.dictionary` - read dictionary and lexicon entries and supply dictionary modules.
 */

import type { IDictionaryApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns, FAKE_DISPOSABLE } from '../defineApiNamespace';

export const dictionaryNamespace = defineApiNamespace<IDictionaryApi>()({
  name: 'dictionary',
  description: 'Read dictionary and lexicon entries, and register dictionary providers.',
  since: '0.1.0',
  permissions: [
    {
      id: 'dictionary:read',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.dictionaryRead',
        text: 'Read dictionary and lexicon entries.',
      },
      since: '0.1.0',
    },
    {
      id: 'dictionary:provide',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.dictionaryProvide',
        text: 'Supply dictionary and lexicon entries to the app.',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    listModules: { permission: 'dictionary:read', fake: fakeReturns([]) },
    lookup: { permission: 'dictionary:read', fake: fakeReturns(null) },
    search: { permission: 'dictionary:read', fake: fakeReturns([]) },
    iterateEntries: { permission: 'dictionary:read', fake: fakeReturns({ entries: [], hasMore: false }) },
    registerProvider: { permission: 'dictionary:provide', fake: FAKE_DISPOSABLE },
  },
  wire: {
    dispose: { permission: null, serves: 'registerProvider' },
  },
});
