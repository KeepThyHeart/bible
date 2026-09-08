/**
 * @bible/extension-ui — Client-side SDK for Bible app extension iframes.
 *
 * Usage:
 * ```typescript
 * import { BibleExtUI } from '@bible/extension-ui';
 *
 * const bible = BibleExtUI.init();
 * bible.linkVerses(document.body);
 * bible.navigateToVerse(43003016); // John 3:16
 * ```
 */

export { BibleExtUI } from './BibleExtUI';
export type {
  ThemeInfo,
  LinkVersesOptions,
  BibleExtUIOptions,
  UiFetchInit,
  UiFetchResponse,
} from './BibleExtUI';
export { RpcClient } from './RpcClient';
export type { Disposable, RpcClientOptions, RpcErrorPayload } from './RpcClient';
export {
  parseReference,
  scanText,
  calculateVerseId,
  getBookNumber,
  getBookName,
} from './verseParser';
export type { ParsedVerseRef, ScannedRef } from './verseParser';
