/**
 * The declaration registry reproduces the hand-maintained tables it replaced
 * (task 0086): same namespaces, permissions, grant policies, activation
 * vocabulary and extension-point gates - so migrating onto it changed no
 * behaviour - and it rejects inconsistent declarations.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as Permissions from '../Permissions';
import * as Activation from '../ActivationEvents';
import { EXTENSION_POINT_KINDS, EXTENSION_POINT_PERMISSIONS } from '../ExtensionPointTypes';
import type * as Api from '../ExtensionApiTypes';
import { defineApiNamespace } from './defineApiNamespace';
import {
  API_NAMESPACES,
  EXTENSION_API_REGISTRY,
  checkMethodGate,
  createApiRegistry,
  type DeclaredPermission,
} from './registry';

// The hand-written tables as they stood when task 0086 replaced them, including
// `api.reminders` (task 0083) and `api.speech` (task 0071), which landed by hand first.
const LEGACY_NAMESPACES = [
  'bible', 'commentary', 'book', 'dictionary', 'notes', 'highlights', 'bookmarks', 'collections',
  'commands', 'ui', 'workspace', 'context', 'storage', 'l10n', 'events', 'runtime', 'panels',
  'network', 'auth', 'tasks', 'extensions', 'ai', 'reminders', 'speech', 'apps',
];

/** `ALLOWED_PERMISSIONS` as it was hand-written before task 0086. */
const LEGACY_PERMISSIONS = [
  'bible:read', 'commentary:read', 'dictionary:read', 'book:read', 'notes:read', 'notes:write',
  'highlights:read', 'highlights:write', 'bookmarks:read', 'bookmarks:write', 'bible:provide',
  'commentary:provide', 'dictionary:provide', 'book:provide', 'storage', 'storage:secrets',
  'storage:database', 'ui:contribute-pane', 'ui:verse-decorator', 'ui:verse-hover',
  'ui:context-menu', 'ui:notification', 'ui:status-bar', 'ui:media', 'commands:register',
  'commands:execute-builtin', 'tasks', 'notifications:schedule', 'network', 'network:oauth',
  'speech:listen', 'speech:speak', 'extensions:call', 'fs:read-user', 'fs:write-user',
  'fs:managed-folder', 'ui:contribute-app',
];

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

describe('extension API registry - parity with the pre-0086 tables', () => {
  it('declares exactly the namespaces BibleExtensionAPI had', () => {
    expect(sorted(EXTENSION_API_REGISTRY.namespaceNames)).toEqual(sorted(LEGACY_NAMESPACES));
  });

  it('declares exactly the permissions the validator allowed', () => {
    expect(sorted(EXTENSION_API_REGISTRY.permissionIds)).toEqual(sorted(LEGACY_PERMISSIONS));
  });

  it('every PERM_* constant names a declared permission', () => {
    const constants = Object.entries(Permissions)
      .filter(([k]) => k.startsWith('PERM_'))
      .map(([, v]) => v as string);
    expect(constants.length).toBe(LEGACY_PERMISSIONS.length);
    for (const c of constants) expect(EXTENSION_API_REGISTRY.permission(c), c).toBeDefined();
  });

  it('keeps the default-granted and separately-prompted sets', () => {
    expect(sorted(Permissions.DEFAULT_GRANTED_PERMISSIONS)).toEqual(['bible:read', 'commands:register']);
    expect(sorted(Permissions.SEPARATELY_PROMPTED_PERMISSIONS)).toEqual(
      sorted(['network', 'network:oauth', 'storage:secrets', 'storage:database', 'fs:managed-folder', 'speech:listen']),
    );
  });

  it('keeps the activation-event vocabulary and firing set', () => {
    expect(sorted(Activation.BARE_ACTIVATION_EVENTS)).toEqual(
      sorted(['onStartupFinished', '*', 'onSession:loaded', 'onSearchProvider', 'onReminder']),
    );
    expect(sorted(Activation.ACTIVATION_EVENT_PREFIXES)).toEqual(
      sorted([
        'onView:', 'onCommand:', 'onLanguage:', 'onFileType:', 'onUri:', 'onContext:',
        'onModuleInstalled:', 'onModuleUpdated:', 'onProviderRoleSelected:', 'onExtensionApi:',
        'onAuthRequired:', 'onTask:', 'onApp:',
      ]),
    );
    expect(sorted(Activation.FIRED_ACTIVATION_EVENTS)).toEqual(
      sorted(['onStartupFinished', 'onCommand:', 'onView:', 'onReminder', 'onApp:']),
    );
  });

  it('declares every extension point exactly once, with its kind', () => {
    for (const [channel, kind] of Object.entries(EXTENSION_POINT_KINDS)) {
      const declared = EXTENSION_API_REGISTRY.eventChannel(channel);
      expect(declared, channel).toBeDefined();
      expect(declared!.kind, channel).toBe(kind);
    }
    expect(EXTENSION_API_REGISTRY.eventChannels.length).toBe(Object.keys(EXTENSION_POINT_KINDS).length);
  });

  it('keeps the extension-point permission table', () => {
    expect(EXTENSION_POINT_PERMISSIONS).toEqual({
      'notes.changed': 'notes:read',
      'notes.beforeDelete': 'notes:read',
      'highlights.afterChange': 'highlights:read',
      'reminder.activated': 'notifications:schedule',
      'reminder.missed': 'notifications:schedule',
      'app.visibilityChanged': 'ui:contribute-app',
    });
  });

  it('keeps the network and tasks namespaces attach-gated', () => {
    expect(EXTENSION_API_REGISTRY.isNamespaceAvailable('network', [])).toBe(false);
    expect(EXTENSION_API_REGISTRY.isNamespaceAvailable('network', ['network'])).toBe(true);
    expect(EXTENSION_API_REGISTRY.isNamespaceAvailable('tasks', ['tasks'])).toBe(true);
    expect(EXTENSION_API_REGISTRY.isNamespaceAvailable('notes', [])).toBe(true);
    expect(EXTENSION_API_REGISTRY.isNamespaceAvailable('nope', [])).toBe(false);
  });

  it('derives BibleExtensionAPI from the declarations', () => {
    expectTypeOf<keyof Api.BibleExtensionAPI>().toEqualTypeOf<(typeof API_NAMESPACES)[number]['name']>();
    expectTypeOf<Api.BibleExtensionAPI['notes']>().toEqualTypeOf<Api.INotesApi>();
    expectTypeOf<Api.BibleExtensionAPI['storage']>().toEqualTypeOf<Api.IStorageApi>();
    expectTypeOf<Api.BibleExtensionAPI['ai']>().toEqualTypeOf<Api.IAiApi>();
    expectTypeOf<'notes:read'>().toMatchTypeOf<DeclaredPermission>();
    expectTypeOf<Permissions.ExtensionPermission>().toEqualTypeOf<DeclaredPermission>();
  });
});

describe('checkMethodGate', () => {
  const granted = new Set(['notes:read']);
  it('handles every gate shape', () => {
    expect(checkMethodGate(null, granted).ok).toBe(true);
    expect(checkMethodGate('notes:read', granted).ok).toBe(true);
    expect(checkMethodGate('notes:write', granted)).toEqual({ ok: false, required: ['notes:write'], anyOf: false });
    expect(checkMethodGate({ anyOf: ['notes:write', 'notes:read'] }, granted).ok).toBe(true);
    expect(checkMethodGate({ anyOf: ['a', 'b'] }, granted)).toEqual({ ok: false, required: ['a', 'b'], anyOf: true });
    expect(checkMethodGate({ checkedBy: 'impl', reason: 'x' }, granted).ok).toBe(true);
  });
});

describe('createApiRegistry rejects inconsistent declarations', () => {
  const ns = (name: string, perm: string, gate: string | null = perm) =>
    defineApiNamespace<{ go(): Promise<void> }>()({
      name,
      description: 'test',
      since: '0.1.0',
      permissions: [{ id: perm, grant: 'prompt', consent: { key: `k.${perm}`, text: 't' }, since: '0.1.0' }],
      methods: { go: { permission: gate } },
    });

  it('duplicate namespace names', () => {
    expect(() => createApiRegistry([ns('a', 'a:x'), ns('a', 'a:y')])).toThrow(/duplicate namespace/);
  });
  it('a permission declared twice', () => {
    expect(() => createApiRegistry([ns('a', 'p'), ns('b', 'p')])).toThrow(/declared by both/);
  });
  it('a method gated by an undeclared permission', () => {
    expect(() => createApiRegistry([ns('a', 'p', 'q')])).toThrow(/undeclared permission "q"/);
  });
  it('a permission without consent text', () => {
    const bad = defineApiNamespace<{ go(): Promise<void> }>()({
      name: 'bad',
      description: 'test',
      since: '0.1.0',
      permissions: [{ id: 'bad:x', grant: 'prompt', consent: { key: 'k', text: '' }, since: '0.1.0' }],
      methods: { go: { permission: null } },
    });
    expect(() => createApiRegistry([bad])).toThrow(/consent/);
  });
});
