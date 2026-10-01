/**
 * `api.l10n` - the extension's translation catalog and the app locale.
 */

import type { IL10nApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const l10nNamespace = defineApiNamespace<IL10nApi>()({
  name: 'l10n',
  description: "Translate strings from the extension's own catalogs and read the current locale.",
  since: '0.1.0',
  permissions: [],
  methods: {
    t: { permission: null, fake: fakeReturns('') },
    currentLocale: { permission: null, fake: fakeReturns('en') },
  },
  events: {
    'locale.changed': {
      kind: 'event',
      permission: null,
      description: 'The app locale changed.',
      since: '0.1.0',
    },
  },
});
