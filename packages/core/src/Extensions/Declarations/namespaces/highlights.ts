/**
 * `api.highlights` - the user's verse highlights and highlight styles.
 */

import type { IHighlightsApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns, FAKE_DISPOSABLE } from '../defineApiNamespace';

const MOCK_HIGHLIGHT = { id: 'mock-hl', range: { verseId: 0 }, styleId: '', createdAt: 0, updatedAt: 0 };

export const highlightsNamespace = defineApiNamespace<IHighlightsApi>()({
  name: 'highlights',
  description: "Read and write the user's verse highlights and register highlight styles.",
  since: '0.1.0',
  permissions: [
    {
      id: 'highlights:read',
      grant: 'prompt',
      consent: { key: 'extensionConsent.permission.highlightsRead', text: 'Read your verse highlights.' },
      since: '0.1.0',
    },
    {
      id: 'highlights:write',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.highlightsWrite',
        text: 'Create and remove your verse highlights.',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    list: { permission: 'highlights:read', fake: fakeReturns([]) },
    create: { permission: 'highlights:write', fake: fakeReturns(MOCK_HIGHLIGHT) },
    update: { permission: 'highlights:write', fake: fakeReturns(MOCK_HIGHLIGHT) },
    delete: { permission: 'highlights:write' },
    registerStyle: { permission: 'highlights:write', fake: FAKE_DISPOSABLE },
    listStyles: { permission: 'highlights:read', fake: fakeReturns([]) },
  },
  wire: {
    dispose: { permission: null, serves: 'registerStyle' },
  },
  events: {
    'highlights.afterChange': {
      kind: 'event',
      permission: 'highlights:read',
      description: 'A highlight on a verse was created, changed or removed.',
      since: '0.1.0',
    },
  },
});
