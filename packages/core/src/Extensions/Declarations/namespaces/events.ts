/**
 * `api.events` - subscribe to host event channels and publish extension-scoped ones.
 */

import type { IEventsApi } from '../../ExtensionApiTypes';
import { FAKE_DISPOSABLE, defineApiNamespace } from '../defineApiNamespace';

export const eventsNamespace = defineApiNamespace<IEventsApi>()({
  name: 'events',
  description: 'Subscribe to extension-point channels and publish extension-scoped events.',
  since: '0.1.0',
  permissions: [],
  methods: {
    subscribe: { permission: null, local: true, fake: FAKE_DISPOSABLE },
    publish: { permission: null },
  },
});
