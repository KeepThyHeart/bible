/**
 * `api.storage` - per-extension key/value storage, keychain secrets, a private SQLite database,
 * settings and a user-chosen managed folder. Owns four permissions.
 */

import type { IStorageApi } from '../../ExtensionApiTypes';
import { defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const storageNamespace = defineApiNamespace<IStorageApi>()({
  name: 'storage',
  description:
    'Keep extension data: key/value storage, OS-keychain secrets, a private SQLite database, settings and a managed folder.',
  since: '0.1.0',
  permissions: [
    {
      id: 'storage',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.storage',
        text: 'Keep a small amount of its own data on this device, readable only by this extension.',
      },
      since: '0.1.0',
    },
    {
      id: 'storage:secrets',
      grant: 'separate',
      consent: {
        key: 'extensionConsent.permission.storageSecrets',
        text: 'Store sensitive secrets (e.g. API keys) in your OS keychain.',
      },
      since: '0.1.0',
    },
    {
      id: 'storage:database',
      grant: 'separate',
      consent: {
        key: 'extensionConsent.permission.storageDatabase',
        text: 'Open and write to a private SQLite database for this extension.',
      },
      since: '0.1.0',
    },
    {
      id: 'fs:managed-folder',
      grant: 'separate',
      consent: {
        key: 'extensionConsent.permission.fsManagedFolder',
        text: 'Read and write files in a folder you choose for it.',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    get: { permission: 'storage' },
    set: { permission: 'storage' },
    delete: { permission: 'storage' },
    keys: { permission: 'storage', fake: fakeReturns([]) },
    setSecret: { permission: 'storage:secrets' },
    getSecret: { permission: 'storage:secrets' },
    deleteSecret: { permission: 'storage:secrets' },
    getSetting: { permission: null },
    setSetting: { permission: null },
    openDatabase: { permission: 'storage:database' },
    diskUsage: { permission: null, fake: fakeReturns({ kv: 0, databases: 0, secretsCount: 0 }) },
    requestFolder: { permission: 'fs:managed-folder', fake: fakeReturns(null) },
    getFolderGrant: { permission: 'fs:managed-folder', fake: fakeReturns(null) },
    revokeFolderGrant: { permission: 'fs:managed-folder' },
    readFile: { permission: 'fs:managed-folder', fake: fakeReturns(new ArrayBuffer(0)) },
    writeFile: { permission: 'fs:managed-folder' },
    deleteFile: { permission: 'fs:managed-folder' },
    listFiles: { permission: 'fs:managed-folder', fake: fakeReturns([]) },
    statFile: { permission: 'fs:managed-folder', fake: fakeReturns(null) },
    getFolderUsage: {
      permission: 'fs:managed-folder',
      fake: fakeReturns({ path: '', fileCount: 0, totalBytes: 0 }),
    },
  },
  wire: {
    dbExec: { permission: 'storage:database', serves: 'IExtensionDatabase.exec' },
    dbQuery: { permission: 'storage:database', serves: 'IExtensionDatabase.query' },
    dbQueryOne: { permission: 'storage:database', serves: 'IExtensionDatabase.queryOne' },
    dbRun: { permission: 'storage:database', serves: 'IExtensionDatabase.run' },
    dbBeginTransaction: { permission: 'storage:database', serves: 'IExtensionDatabase.transaction' },
    dbCommit: { permission: 'storage:database', serves: 'IExtensionDatabase.transaction' },
    dbRollback: { permission: 'storage:database', serves: 'IExtensionDatabase.transaction' },
    dbClose: { permission: 'storage:database', serves: 'IExtensionDatabase.close' },
  },
  events: {
    'settings.changed': {
      kind: 'event',
      permission: null,
      description: "One of the extension's settings changed.",
      since: '0.1.0',
    },
  },
  contributes: [
    {
      key: 'configuration',
      description: "The extension's user-editable settings schema, rendered as a settings form.",
      since: '0.1.0',
    },
  ],
});
