/**
 * Frontend API wrapper for prayer list operations.
 *
 * Uses the `Result<T>` envelope convention. Handlers live in
 * `electron/ipc/notesHandlers.ts` (prayer-lists:* channels).
 */

import { unwrap } from './ipcResult';

export interface SerializedPrayerList {
  userCommentaryId?: number;
  name: string;
  description?: string;
  createdDate?: string;
  modifiedDate?: string;
  isDefault: boolean;
  color?: string;
  metadata?: any;
  prayerCount?: number; // Number of prayers in this list
}

// Access Electron IPC from window object
const ipcRenderer = (window as any).electron?.ipcRenderer;

if (!ipcRenderer) {
  console.warn('Electron IPC not available - prayer list API will not work');
}

/**
 * Get all prayer lists
 */
export async function getAllPrayerLists(): Promise<SerializedPrayerList[]> {
  return unwrap<SerializedPrayerList[]>(ipcRenderer.invoke('prayer-lists:get-all'));
}

/**
 * Get a prayer list by ID
 */
export async function getPrayerListById(id: number): Promise<SerializedPrayerList | null> {
  return unwrap<SerializedPrayerList | null>(ipcRenderer.invoke('prayer-lists:get-by-id', id));
}

/**
 * Create a new prayer list
 */
export async function createPrayerList(listData: Partial<SerializedPrayerList>): Promise<SerializedPrayerList> {
  return unwrap<SerializedPrayerList>(ipcRenderer.invoke('prayer-lists:create', listData));
}

/**
 * Update a prayer list
 */
export async function updatePrayerList(list: SerializedPrayerList): Promise<SerializedPrayerList> {
  return unwrap<SerializedPrayerList>(ipcRenderer.invoke('prayer-lists:update', list));
}

/**
 * Delete a prayer list.
 * Returns true on success, false if the record was not found.
 * Unexpected errors still throw.
 */
export async function deletePrayerList(id: number): Promise<boolean> {
  return unwrap<boolean>(ipcRenderer.invoke('prayer-lists:delete', id));
}

/**
 * Get prayers for a specific list
 */
export async function getPrayersForList(listId: number): Promise<any[]> {
  return unwrap<any[]>(ipcRenderer.invoke('prayer-lists:get-prayers', listId));
}

/**
 * Get prayer count for a list
 */
export async function getPrayerCount(listId: number): Promise<number> {
  return unwrap<number>(ipcRenderer.invoke('prayer-lists:get-prayer-count', listId));
}

/**
 * Reorder prayers in a list. Resolves on success, throws on failure.
 */
export async function reorderPrayers(listId: number, prayerIds: number[]): Promise<boolean> {
  await unwrap<void>(ipcRenderer.invoke('prayer-lists:reorder-prayers', listId, prayerIds));
  return true;
}

/**
 * Reorder prayer lists. Resolves on success, throws on failure.
 */
export async function reorderPrayerLists(listIds: number[]): Promise<boolean> {
  await unwrap<void>(ipcRenderer.invoke('prayer-lists:reorder', listIds));
  return true;
}
