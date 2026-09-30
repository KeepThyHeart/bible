/**
 * Renderer side of keyword-set persistence (task 0065). The sets live in the
 * user database (`electron/ipc/keywordHandlers.ts`); this adapter lets core's
 * `KeywordSetService` treat that IPC as its `IKeywordSetStore`.
 */
import type { IKeywordSetStore, KeywordSet } from '@bible/core/browser';
import { unwrap, type Result } from './ipcResult';

type KeywordChannel = 'keywords:list' | 'keywords:put' | 'keywords:remove';
type Invoke = (channel: KeywordChannel, ...args: unknown[]) => Promise<Result<unknown>>;

const defaultInvoke: Invoke = (channel, ...args) =>
  window.electron.ipcRenderer.invoke<Result<unknown>>(channel, ...args);

export class IpcKeywordSetStore implements IKeywordSetStore {
  constructor(private readonly invoke: Invoke = defaultInvoke) {}

  list(): Promise<KeywordSet[]> {
    return unwrap(this.invoke('keywords:list') as Promise<Result<KeywordSet[]>>);
  }

  async put(set: KeywordSet): Promise<void> {
    await unwrap(this.invoke('keywords:put', set));
  }

  async remove(id: string): Promise<void> {
    await unwrap(this.invoke('keywords:remove', id));
  }
}

export const keywordSetsAPI = new IpcKeywordSetStore();
