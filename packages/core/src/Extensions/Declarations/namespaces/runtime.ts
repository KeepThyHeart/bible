/**
 * `api.runtime` - worker-local endpoints other parts of the app can call into.
 */

import type { IRuntimeApi } from '../../ExtensionApiTypes';
import { FAKE_DISPOSABLE, defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const runtimeNamespace = defineApiNamespace<IRuntimeApi>()({
  name: 'runtime',
  description: 'Expose worker-side handler functions as named reverse-RPC endpoints.',
  since: '0.1.0',
  permissions: [],
  methods: {
    expose: { permission: null, local: true, fake: FAKE_DISPOSABLE },
    unexpose: { permission: null, local: true },
    listExposed: { permission: null, local: true, fake: fakeReturns([]) },
  },
});
