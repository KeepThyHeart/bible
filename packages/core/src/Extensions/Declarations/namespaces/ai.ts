/**
 * `api.ai` - reserved AI-support probe; the host currently always answers `false`.
 */

import type { IAiApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const aiNamespace = defineApiNamespace<IAiApi>()({
  name: 'ai',
  description: 'Check whether the host offers AI features (reserved; always false for now).',
  since: '0.1.0',
  permissions: [],
  methods: {
    isAvailable: { permission: null, fake: fakeReturns(false) },
  },
});
