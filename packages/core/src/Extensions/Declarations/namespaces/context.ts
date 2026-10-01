/**
 * `api.context` - the "when clause" context keys.
 */

import type { IContextApi } from '../../ExtensionApiTypes';
import { defineApiNamespace } from '../defineApiNamespace';

export const contextNamespace = defineApiNamespace<IContextApi>()({
  name: 'context',
  description: 'Read and set context keys used by when-clauses.',
  since: '0.1.0',
  permissions: [],
  methods: {
    get: { permission: null },
    set: { permission: null },
  },
  activationEvents: [
    {
      event: 'onContext:',
      fired: false,
      description: 'Activate when the named context key becomes true (onContext:<key>); not yet fired by the host.',
      since: '0.1.0',
    },
  ],
});
