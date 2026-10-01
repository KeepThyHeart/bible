/**
 * `api.notes` - the user's personal notes.
 */

import type { INotesApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const notesNamespace = defineApiNamespace<INotesApi>()({
  name: 'notes',
  description: "Read and write the user's personal notes.",
  since: '0.1.0',
  permissions: [
    {
      id: 'notes:read',
      grant: 'prompt',
      consent: { key: 'extensionConsent.permission.notesRead', text: 'Read your personal notes.' },
      since: '0.1.0',
    },
    {
      id: 'notes:write',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.notesWrite',
        text: 'Create, modify, and delete your personal notes.',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    list: { permission: 'notes:read', fake: fakeReturns([]) },
    get: { permission: 'notes:read', fake: fakeReturns(null) },
    create: {
      permission: 'notes:write',
      fake: fakeReturns({ id: 'mock-note', content: '', createdAt: 0, updatedAt: 0 }),
    },
    update: {
      permission: 'notes:write',
      fake: fakeReturns({ id: 'mock-note', content: '', createdAt: 0, updatedAt: 0 }),
    },
    delete: { permission: 'notes:write' },
  },
  events: {
    'notes.changed': {
      kind: 'event',
      permission: 'notes:read',
      description: 'A note was created, updated or deleted.',
      since: '0.1.0',
    },
    'notes.beforeDelete': {
      kind: 'filter',
      permission: 'notes:read',
      description: "A note is about to be deleted; a subscriber may answer 'cancel'.",
      since: '0.1.0',
    },
  },
});
