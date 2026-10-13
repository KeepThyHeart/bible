/** The page's accounts store (lazy chunk), wired to the user-DB client, the module catalog and the browser. */
import { moduleStore } from '../../stores/moduleStore';
import { AccountStore } from './accountStore';
import type { AccountsTransport } from './accountStore';

export function saveTextFile(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export const accountStore = new AccountStore({
  connect: async () => {
    const { getUserDbClient } = await import('../../userdb/client');
    return (await getUserDbClient()) as unknown as AccountsTransport;
  },
  modules: {
    list: () => moduleStore.availableModules.map((m) => ({ id: m.module_id, abbr: m.abbreviation })),
    subscribe: (cb) => moduleStore.subscribe(cb),
  },
  saveFile: saveTextFile,
  backup: async (password) => {
    const { downloadBackup } = await import('../../userdata/backupFiles');
    return downloadBackup({ password });
  },
});
