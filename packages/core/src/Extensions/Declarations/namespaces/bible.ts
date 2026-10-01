/**
 * `api.bible` - read Bible text and tokens, and supply Bible modules.
 */

import type { IBibleApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns, FAKE_DISPOSABLE } from '../defineApiNamespace';

export const bibleNamespace = defineApiNamespace<IBibleApi>()({
  name: 'bible',
  description: 'Read Bible verses, books and tokens, and register Bible text providers.',
  since: '0.1.0',
  permissions: [
    {
      id: 'bible:read',
      grant: 'default',
      consent: {
        key: 'extensionConsent.permission.bibleRead',
        text: 'Read Bible verses from any installed translation.',
      },
      since: '0.1.0',
    },
    {
      id: 'bible:provide',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.bibleProvide',
        text: 'Supply Bible text to the app from its own source.',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    getVerse: { permission: 'bible:read', fake: fakeReturns({ verseId: 0, text: '' }) },
    getRange: { permission: 'bible:read', fake: fakeReturns([]) },
    listModules: { permission: 'bible:read', fake: fakeReturns([]) },
    listBooks: { permission: 'bible:read', fake: fakeReturns([]) },
    listChapters: { permission: 'bible:read', fake: fakeReturns([]) },
    iterateVerses: { permission: 'bible:read', fake: fakeReturns({ verses: [], hasMore: false }) },
    parseReference: { permission: 'bible:read', fake: fakeReturns(null) },
    getVerseTokens: { permission: 'bible:read', fake: fakeReturns(null) },
    getTokensForRange: { permission: 'bible:read', fake: fakeReturns({}) },
    navigateToVerse: { permission: 'bible:read' },
    registerProvider: { permission: 'bible:provide', fake: FAKE_DISPOSABLE },
  },
  wire: {
    dispose: { permission: null, serves: 'registerProvider' },
  },
  contributes: [
    {
      key: 'bibleProviders',
      description: 'Bible text providers the extension registers at runtime.',
      since: '0.1.0',
    },
  ],
  events: {
    'verse.activeChanged': {
      kind: 'event',
      permission: null,
      description: "The user's active verse changed (null when nothing is active).",
      since: '0.1.0',
    },
    'verse.wordSelected': {
      kind: 'event',
      permission: null,
      description: 'The user selected a word in a verse.',
      since: '0.1.0',
    },
    'search.beforeQuery': {
      kind: 'filter',
      permission: null,
      description: 'A search query is about to run; a subscriber may rewrite it.',
      since: '0.1.0',
    },
    'crossReferences.requested': {
      kind: 'provider',
      permission: null,
      description: 'Cross references were requested for a verse; subscribers contribute results.',
      since: '0.1.0',
    },
  },
});
