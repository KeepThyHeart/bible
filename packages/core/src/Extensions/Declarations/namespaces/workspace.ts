/**
 * `api.workspace` - inspect and control the app's open panels.
 */

import type { IWorkspaceApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const workspaceNamespace = defineApiNamespace<IWorkspaceApi>()({
  name: 'workspace',
  description: 'Query, open, close and annotate panels in the workspace.',
  since: '0.1.0',
  permissions: [],
  methods: {
    getActivePanel: { permission: null, fake: fakeReturns(null) },
    getOpenPanels: { permission: null, fake: fakeReturns([]) },
    openPanel: { permission: null, fake: fakeReturns('mock-panel-id') },
    closePanel: { permission: null },
    setPanelTitle: { permission: null },
    setPanelBadge: { permission: null },
    revealPanel: { permission: null, fake: fakeReturns(true) },
  },
  events: {
    'panel.opened': {
      kind: 'event',
      permission: null,
      description: 'A panel was opened.',
      since: '0.1.0',
    },
    'panel.closed': {
      kind: 'event',
      permission: null,
      description: 'A panel was closed.',
      since: '0.1.0',
    },
    'panel.focused': {
      kind: 'event',
      permission: null,
      description: 'The focused panel changed (null when no panel is focused).',
      since: '0.1.0',
    },
  },
});
