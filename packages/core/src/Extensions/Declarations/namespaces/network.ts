/**
 * `api.network` - mediated outbound HTTP(S) restricted to the manifest's allowed hosts.
 */

import type { INetworkApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const networkNamespace = defineApiNamespace<INetworkApi>()({
  name: 'network',
  description: "Make outbound HTTP(S) requests to the hosts listed in the extension's manifest.",
  since: '0.1.0',
  availability: { whenGranted: 'network' },
  permissions: [
    {
      id: 'network',
      grant: 'separate',
      consent: {
        key: 'extensionConsent.permission.network',
        text: 'Access the internet (only the hosts listed below).',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    fetch: {
      permission: 'network',
      fake: fakeReturns({ ok: true, status: 200, statusText: 'OK', headers: {}, url: '', body: '' }),
    },
    isHostAllowed: { permission: 'network', fake: fakeReturns(false) },
  },
});
