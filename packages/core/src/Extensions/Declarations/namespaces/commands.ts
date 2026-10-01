/**
 * `api.commands` - register and run commands.
 */

import type { ICommandsApi } from '../../ExtensionApiTypes';
import { FAKE_DISPOSABLE, defineApiNamespace } from '../defineApiNamespace';

export const commandsNamespace = defineApiNamespace<ICommandsApi>()({
  name: 'commands',
  description: 'Register commands in the command palette and execute them.',
  since: '0.1.0',
  permissions: [
    {
      id: 'commands:register',
      grant: 'default',
      consent: {
        key: 'extensionConsent.permission.commandsRegister',
        text: 'Add commands to the command palette.',
      },
      since: '0.1.0',
    },
    {
      id: 'commands:execute-builtin',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.commandsExecuteBuiltin',
        text: 'Run certain built-in app commands (e.g. opening Preferences).',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    register: { permission: 'commands:register', fake: FAKE_DISPOSABLE },
    execute: {
      permission: {
        checkedBy: 'impl',
        reason:
          "Free for the extension's own commands; an allowlisted built-in additionally needs 'commands:execute-builtin'.",
      },
    },
  },
  wire: {
    dispose: { permission: null, serves: 'register (DisposableHandle.dispose)' },
  },
  activationEvents: [
    {
      event: 'onCommand:',
      fired: true,
      description: 'Activate when the named command is invoked (onCommand:<commandId>).',
      since: '0.1.0',
    },
  ],
  contributes: [
    {
      key: 'commands',
      description: 'Commands the extension adds to the command palette.',
      since: '0.1.0',
    },
  ],
});
