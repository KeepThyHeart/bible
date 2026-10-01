/**
 * `api.extensions` - calling API methods that other extensions export.
 */

import type { IExtensionsApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const extensionsNamespace = defineApiNamespace<IExtensionsApi>()({
  name: 'extensions',
  description: 'Call methods other extensions export through `contributes.apiExports`.',
  since: '0.1.0',
  permissions: [
    {
      id: 'extensions:call',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.extensionsCall',
        text: 'Call functions that other extensions offer.',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    call: { permission: 'extensions:call' },
    isActive: { permission: null, fake: fakeReturns(false) },
    listProviders: { permission: null, fake: fakeReturns([]) },
  },
  events: {
    'extension.activated': {
      kind: 'event',
      permission: null,
      description: 'Another extension was activated.',
      since: '0.1.0',
    },
    'extension.deactivated': {
      kind: 'event',
      permission: null,
      description: 'Another extension was deactivated.',
      since: '0.1.0',
    },
  },
  activationEvents: [
    {
      event: 'onExtensionApi:',
      fired: false,
      description: "Activate when another extension calls one of this extension's exported API methods.",
      since: '0.1.0',
    },
    {
      event: 'onProviderRoleSelected:',
      fired: false,
      description: 'Activate when this extension is selected for a provider role.',
      since: '0.1.0',
    },
  ],
  contributes: [
    {
      key: 'apiExports',
      description: 'Methods this extension exports for other extensions to call.',
      since: '0.1.0',
    },
  ],
});
