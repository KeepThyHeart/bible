/**
 * `api.tasks` - long-running background tasks with progress and cancellation.
 */

import type { ITasksApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const tasksNamespace = defineApiNamespace<ITasksApi>()({
  name: 'tasks',
  description: 'Run background tasks that report progress and can be cancelled.',
  since: '0.1.0',
  availability: { whenGranted: 'tasks' },
  permissions: [
    {
      id: 'tasks',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.tasks',
        text: 'Run background tasks that show their progress.',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    run: { permission: 'tasks' },
    reportProgress: { permission: 'tasks' },
    isCancellationRequested: { permission: 'tasks', fake: fakeReturns(false) },
    cancel: { permission: 'tasks' },
    list: { permission: 'tasks', fake: fakeReturns([]) },
  },
  activationEvents: [
    {
      event: 'onTask:',
      fired: false,
      description: 'Activate when the named background task is requested.',
      since: '0.1.0',
    },
  ],
});
