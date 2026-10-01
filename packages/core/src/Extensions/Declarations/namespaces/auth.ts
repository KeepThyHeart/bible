/**
 * `api.auth` - OAuth 2.0 flows and opening the default browser. Attached only alongside `network`.
 */

import type { IAuthApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const authNamespace = defineApiNamespace<IAuthApi>()({
  name: 'auth',
  description: 'Run OAuth 2.0 authorization flows and open external login pages in the default browser.',
  since: '0.1.0',
  availability: { whenGranted: 'network' },
  permissions: [
    {
      id: 'network:oauth',
      grant: 'separate',
      consent: {
        key: 'extensionConsent.permission.networkOauth',
        text: 'Open external OAuth login pages in your default browser.',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    startOAuth: {
      permission: 'network',
      fake: fakeReturns({ accessToken: '', tokenType: 'Bearer', raw: {} }),
    },
    refreshOAuth: {
      permission: 'network',
      fake: fakeReturns({ accessToken: '', tokenType: 'Bearer', raw: {} }),
    },
    openExternal: { permission: 'network:oauth' },
  },
});
