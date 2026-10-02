/**
 * `api.commentary` - read commentary entries and supply commentary modules.
 */

import type { ICommentaryApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns, FAKE_DISPOSABLE } from '../defineApiNamespace';

export const commentaryNamespace = defineApiNamespace<ICommentaryApi>()({
  name: 'commentary',
  description: 'Read commentary modules and entries, and register commentary providers.',
  since: '0.1.0',
  permissions: [
    {
      id: 'commentary:read',
      grant: 'prompt',
      consent: { key: 'extensionConsent.permission.commentaryRead', text: 'Read commentary entries.' },
      since: '0.1.0',
    },
    {
      id: 'commentary:provide',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.commentaryProvide',
        text: 'Supply commentary entries to the app.',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    listModules: { permission: 'commentary:read', fake: fakeReturns([]) },
    getEntry: { permission: 'commentary:read', fake: fakeReturns(null) },
    getEntriesForRange: { permission: 'commentary:read', fake: fakeReturns([]) },
    iterateEntries: { permission: 'commentary:read', fake: fakeReturns({ entries: [], hasMore: false }) },
    registerProvider: { permission: 'commentary:provide', fake: FAKE_DISPOSABLE },
  },
  wire: {
    dispose: { permission: null, serves: 'registerProvider' },
  },
});
