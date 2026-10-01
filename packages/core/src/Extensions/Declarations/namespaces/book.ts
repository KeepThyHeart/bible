/**
 * `api.book` - read books and their sections, and supply book modules.
 */

import type { IBookApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns, FAKE_DISPOSABLE } from '../defineApiNamespace';

export const bookNamespace = defineApiNamespace<IBookApi>()({
  name: 'book',
  description: 'Read books and their sections, and register book providers.',
  since: '0.1.0',
  permissions: [
    {
      id: 'book:read',
      grant: 'prompt',
      consent: { key: 'extensionConsent.permission.bookRead', text: 'Read books and their sections.' },
      since: '0.1.0',
    },
    {
      id: 'book:provide',
      grant: 'prompt',
      consent: { key: 'extensionConsent.permission.bookProvide', text: 'Supply books to the app.' },
      since: '0.1.0',
    },
  ],
  methods: {
    listModules: { permission: 'book:read', fake: fakeReturns([]) },
    getSection: { permission: 'book:read', fake: fakeReturns(null) },
    listSections: { permission: 'book:read', fake: fakeReturns([]) },
    iterateSections: { permission: 'book:read', fake: fakeReturns({ sections: [], hasMore: false }) },
    registerProvider: { permission: 'book:provide', fake: FAKE_DISPOSABLE },
  },
  wire: {
    dispose: { permission: null, serves: 'registerProvider' },
  },
});
