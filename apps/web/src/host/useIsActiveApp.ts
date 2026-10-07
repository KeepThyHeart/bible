import type { AppId } from '@bible/core/browser';
import { appHost } from './appHost';
import { useReadable } from './useReadable';

/**
 * True while `id` is the app on screen. Kept-alive apps stay mounted (hidden
 * and `inert`) behind the active one, but `inert` does not stop `window` key
 * listeners, so an app's global key handlers must gate on this.
 */
export function useIsActiveApp(id: AppId): boolean {
  return useReadable(appHost).activeId === id;
}
