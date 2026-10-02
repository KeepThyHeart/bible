/**
 * `api.panels` - the message channel between the worker and its panel iframes.
 */

import type { IPanelsApi } from '../../ExtensionApiTypes';
import { FAKE_DISPOSABLE, defineApiNamespace } from '../defineApiNamespace';

export const panelsNamespace = defineApiNamespace<IPanelsApi>()({
  name: 'panels',
  description: "Exchange messages with the extension's own panel iframes.",
  since: '0.1.0',
  permissions: [],
  methods: {
    onMessage: { permission: null, local: true, fake: FAKE_DISPOSABLE },
    postMessage: { permission: null },
  },
  wire: {
    setMessageHandler: { permission: null, serves: 'onMessage (tells the host whether a handler is registered)' },
  },
});
