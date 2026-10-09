/**
 * What the memory core needs from its host, as narrow ports.
 *
 * The extension used `api.storage.openDatabase`, `api.bible.*`, `api.speech`
 * and `api.reminders`. A built-in module calls host services directly, so
 * these are plain interfaces the desktop main process (and later the web app)
 * implements. Every import here is `import type`: the core carries no runtime
 * dependency on the host.
 */

import type { Extensions } from '@bible/core';
import type { ISpeechApi } from '@bible/core/speech';

export type BibleVerseDto = Extensions.BibleVerseDto;
export type BibleBookDto = Extensions.BibleBookDto;
export type BibleChapterDto = Extensions.BibleChapterDto;
export type BibleModuleInfoDto = Extensions.BibleModuleInfoDto;
export type ParsedReferenceDto = Extensions.ParsedReferenceDto;
export type DisposableHandle = Extensions.DisposableHandle;
export type IRemindersApi = Extensions.IRemindersApi;

/**
 * Async SQL over the user database: the same shape as the extension's
 * `IExtensionDatabase`, so the store's SQL is unchanged by the move.
 *
 * Rule for `transaction`: the work function uses only the `tx` it is given,
 * and awaits nothing but `tx` calls. The desktop port holds a lock for the
 * transaction's length; a call on the outer port from inside it would wait
 * for itself.
 */
export interface MemorySql {
  exec(sql: string): Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number | string }>;
  transaction<T>(work: (tx: MemorySql) => Promise<T>): Promise<T>;
}

/** The slice of the host's Bible service the core reads. Same signatures as the extension API's `bible`. */
export type MemoryBibleApi = Pick<
  Extensions.IBibleApi,
  'getRange' | 'listModules' | 'listBooks' | 'listChapters' | 'parseReference' | 'navigateToVerse'
>;

/**
 * The object the ported domain code was handed as `api`: `bible` always,
 * `speech` and `reminders` when the host has them.
 */
export interface MemoryHostApi {
  readonly bible: MemoryBibleApi;
  readonly speech?: ISpeechApi;
  readonly reminders?: IRemindersApi;
}
