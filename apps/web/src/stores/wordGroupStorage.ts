/**
 * Saved word groups for the Word study pane.
 *
 * The word study server keeps no groups, so they live in this browser's
 * localStorage. TODO(task 0063): move them to the core user-data layer when web
 * accounts / sync land, so groups follow the reader across devices.
 */
import { normalizeWordGroup } from '@bible/core/browser';
import type { WordGroup } from '@bible/core/browser';

export const WORD_GROUPS_KEY = 'bible.wordGroups.v1';

function readAll(): WordGroup[] {
  try {
    const raw = localStorage.getItem(WORD_GROUPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: WordGroup[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Partial<WordGroup>;
      if (!Array.isArray(rec.terms) || !rec.terms.every((t) => typeof t === 'string')) continue;
      const group = normalizeWordGroup({ ...rec, terms: rec.terms as string[] });
      if (group.terms.length > 0) out.push(group);
    }
    return out;
  } catch {
    return [];
  }
}

function writeAll(groups: WordGroup[]): void {
  try {
    localStorage.setItem(WORD_GROUPS_KEY, JSON.stringify(groups));
  } catch { /* storage unavailable or full: groups just do not persist */ }
}

/** All saved groups, oldest first. */
export function listWordGroups(): WordGroup[] {
  return readAll();
}

/** Save (insert or replace by id) a group; returns the normalized group that was stored. */
export function saveWordGroup(group: WordGroup): WordGroup {
  const normalized = normalizeWordGroup(group);
  const all = readAll();
  const i = all.findIndex((g) => g.id === normalized.id);
  if (i >= 0) all[i] = normalized; else all.push(normalized);
  writeAll(all);
  return normalized;
}

export function removeWordGroup(id: string): void {
  writeAll(readAll().filter((g) => g.id !== id));
}
