import { useEffect, useState } from 'react';
import { unwrap } from '../../services/ipcResult';
import {
  studyOverviewProvider,
  type StudyOverviewProvider,
  type XrefGroupWithEntries,
} from '../../services/studyOverviewProvider';
import type { ModuleCrossReferences, CrossReferencePhraseGroup } from './CrossReferenceDisplay';
import type { VerseLinksSummary } from './VerseLinksDisplay';

/**
 * ONE chapter-wide load for everything Study mode adorns a verse with.
 *
 * ## Why one load
 *
 * Loading per-verse instead would issue roughly 122 IPC round trips per
 * chapter, spread across three uncoordinated sources:
 *
 *   - `xref:getAvailable` + `xref:getGroupsForVerse` - once per verse per
 *     cross-reference module (~31), from `StudyModeView`, with no loading state;
 *   - `study:getVerseLinks` - once per verse (~31), from a `VerseLinksDisplay`
 *     mounted on every row, each fanning out in the main process across 24
 *     commentary modules and 26 book modules (~2,300 SQL statements per chapter);
 *   - a second, redundant `xref:getAvailable` and an `xref:getReverseReferences`
 *     per verse per module (~62), from the same component.
 *
 * Each reply would land at its own moment and change the height of its verse
 * row, reflowing the chapter under the reader several times per navigation.
 * Fetches living *inside* the subtree that the interlinear loading gate
 * unmounts would also mean toggling Interlinear re-runs all ninety of them.
 *
 * Everything loads here instead, above that subtree, in a fixed small number
 * of calls, and `resolved` lets the caller withhold the verses until the
 * whole set has landed - one paint, fully adorned.
 *
 * ## Sources
 *
 * Cross-reference phrase groups come from the pre-generated study cache when it
 * is usable (`study:getOverview`, one call for the chapter). When it is absent
 * or stale the same data is read live through `xref:getGroupsForRange`, one
 * call per installed module. Verse links have no cache and always use their
 * batch IPC.
 */

/** Longest verse range a single cross-reference entry is expanded into.
 *
 * TSK stores ranges as (start, end) pairs. Expanding them lets
 * `collapseReferencesStructured` print `1Jo 4:9-10` instead of two disjoint
 * references, but a pathological end id would otherwise generate thousands of
 * ids. Beyond the cap only the endpoints are kept.
 */
const MAX_RANGE_EXPANSION = 20;

/** Cross-reference module summary, as returned by `xref:getAvailable`. */
interface XrefModuleSummary {
  abbreviation: string;
  name: string;
}

/** Everything one chapter of Study mode needs, keyed by verse id. */
export interface ChapterStudyData {
  /** Cross-reference modules and their phrase groups, per verse. */
  crossRefsByVerse: Map<number, ModuleCrossReferences[]>;
  /** Commentaries, books, notes and counts, per verse. */
  linksByVerse: Map<number, VerseLinksSummary>;
  /**
   * Every source has answered for the current chapter. Until this is true the
   * caller must not paint verse adornments, or it paints them twice.
   */
  resolved: boolean;
}

const EMPTY: ChapterStudyData = {
  crossRefsByVerse: new Map(),
  linksByVerse: new Map(),
  resolved: false,
};

/**
 * Flatten a phrase group's entries into the target verse ids to show.
 *
 * Ranges are only expanded within a single book+chapter: verse counts differ
 * per chapter, so walking a range across a chapter boundary would invent verse
 * ids that do not exist.
 */
export function targetVerseIdsFromGroup(group: XrefGroupWithEntries): number[] {
  const ids: number[] = [];
  for (const entry of group.entries) {
    const start = entry.target_verse_id;
    const end = entry.target_verse_end_id ?? start;
    const sameChapter = Math.floor(start / 1000) === Math.floor(end / 1000);
    if (end > start && sameChapter && end - start <= MAX_RANGE_EXPANSION) {
      for (let id = start; id <= end; id++) ids.push(id);
    } else {
      ids.push(start);
      if (end !== start) ids.push(end);
    }
  }
  return ids;
}

/**
 * Turn raw phrase groups into the display shape, dropping empty groups.
 *
 * Whole-verse groups (no phrase) are hoisted to the front - the reader wants
 * the references that apply to the verse as a whole before the ones scoped to
 * one of its words. Matches the dockview Study pane and the web pane.
 */
function toPhraseGroups(groups: XrefGroupWithEntries[]): CrossReferencePhraseGroup[] {
  return groups
    .map((group, index) => ({
      groupId: group.group.group_id ?? index,
      phrase: group.group.phrase,
      verseIds: targetVerseIdsFromGroup(group),
    }))
    .filter(group => group.verseIds.length > 0)
    .sort((a, b) => {
      // Tested for absence, not `=== null`: the repository maps a NULL phrase
      // column to `undefined` on the way through the DTO.
      const aWhole = !a.phrase;
      const bWhole = !b.phrase;
      if (aWhole !== bWhole) return aWhole ? -1 : 1;
      return 0;
    });
}

/** Add one module's groups for one verse to the accumulator. */
function addModuleGroups(
  target: Map<number, ModuleCrossReferences[]>,
  verseId: number,
  module: { abbreviation: string; name: string },
  groups: XrefGroupWithEntries[]
): void {
  const phraseGroups = toPhraseGroups(groups);
  if (phraseGroups.length === 0) return;
  const existing = target.get(verseId) ?? [];
  existing.push({ abbreviation: module.abbreviation, moduleName: module.name, groups: phraseGroups });
  target.set(verseId, existing);
}

/**
 * Cross-reference groups for the chapter, from the study cache when it is
 * usable and from the live range IPC otherwise.
 */
async function loadCrossReferences(
  bookNumber: number,
  chapter: number,
  verseIds: number[],
  modules: XrefModuleSummary[],
  provider: StudyOverviewProvider
): Promise<Map<number, ModuleCrossReferences[]>> {
  const byVerse = new Map<number, ModuleCrossReferences[]>();
  if (verseIds.length === 0 || modules.length === 0) return byVerse;

  await provider.loadChapter(bookNumber, chapter);

  if (provider.hasChapter(bookNumber, chapter)) {
    const byAbbreviation = new Map(modules.map(mod => [mod.abbreviation, mod]));
    for (const verseId of verseIds) {
      // The cache carries every module's groups in one list, tagged with `src`.
      const bySource = new Map<string, XrefGroupWithEntries[]>();
      for (const group of provider.getCrossRefsForVerse(bookNumber, chapter, verseId)) {
        const src = group.source ?? '';
        const bucket = bySource.get(src);
        if (bucket) bucket.push(group);
        else bySource.set(src, [group]);
      }
      for (const [src, groups] of bySource) {
        // A module registered since generation is not in the cache at all -
        // but the fingerprint check already disabled the cache in that case,
        // so an unknown source here can only be a module removed since.
        const mod = byAbbreviation.get(src);
        if (!mod) continue;
        addModuleGroups(byVerse, verseId, mod, groups);
      }
    }
    return byVerse;
  }

  // Live fallback: one call per module for the whole chapter.
  const start = verseIds[0];
  const end = verseIds[verseIds.length - 1];
  const perModule = await Promise.all(
    modules.map(async mod => ({
      mod,
      groups: await unwrap<XrefGroupWithEntries[]>(
        window.electron.crossReference.getGroupsForRange(mod.abbreviation, start, end)
      ).catch(() => [] as XrefGroupWithEntries[]),
    }))
  );

  for (const { mod, groups } of perModule) {
    for (const verseId of verseIds) {
      // Containment on the group's own anchor range, the predicate
      // `getGroupsForVerse` uses.
      const covering = groups.filter(g => {
        const anchorStart = g.group.verse_id ?? verseId;
        const anchorEnd = g.group.verse_id_end ?? anchorStart;
        return anchorStart <= verseId && anchorEnd >= verseId;
      });
      addModuleGroups(byVerse, verseId, mod, covering);
    }
  }

  return byVerse;
}

/** Verse links for the whole chapter, in one `study:getBatchVerseLinks` call. */
async function loadVerseLinks(verseIds: number[]): Promise<Map<number, VerseLinksSummary>> {
  const byVerse = new Map<number, VerseLinksSummary>();
  if (verseIds.length === 0) return byVerse;

  // TODO: Get open module IDs from session state (carried over from the
  // per-verse implementation this replaces).
  const openModuleIds: number[] = [];
  const result = await unwrap<Record<number, VerseLinksSummary>>(
    window.electron.study.getBatchVerseLinks(verseIds, openModuleIds)
  );
  for (const [verseIdStr, summary] of Object.entries(result)) {
    byVerse.set(Number(verseIdStr), summary);
  }
  return byVerse;
}

/**
 * Load every adornment for one chapter.
 *
 * @param verseIds        Ascending verse ids of the rendered chapter.
 * @param bookNumber      Book of the chapter, for the study-cache lookup.
 * @param chapter         Chapter number, for the study-cache lookup.
 * @param showCrossRefs   When false the cross-reference sources are skipped
 *                        entirely - the toggle is off, so nothing would render.
 * @param provider        Injectable for tests.
 */
export function useChapterStudyData(
  verseIds: number[],
  bookNumber: number,
  chapter: number,
  showCrossRefs: boolean,
  provider: StudyOverviewProvider = studyOverviewProvider
): ChapterStudyData {
  const [data, setData] = useState<ChapterStudyData>(EMPTY);

  // Depend on the id list by value, not identity: `verses` is a fresh array on
  // every render of the parent, and depending on it re-ran the whole load on
  // unrelated re-renders.
  const verseKey = verseIds.join(',');

  useEffect(() => {
    let cancelled = false;
    setData(EMPTY);

    if (verseIds.length === 0) {
      setData({ ...EMPTY, resolved: true });
      return;
    }

    const load = async (): Promise<void> => {
      // The whole body is guarded: `window.electron` is absent in unit tests
      // and in a renderer whose preload failed, and a throw reaching the
      // caller would leave `resolved` false forever - i.e. a chapter that
      // never paints.
      const modules = showCrossRefs
        ? await unwrap<XrefModuleSummary[]>(window.electron.crossReference.getAvailable()).catch(
            () => [] as XrefModuleSummary[]
          )
        : [];

      const [crossRefsByVerse, linksByVerse] = await Promise.all([
        showCrossRefs
          ? loadCrossReferences(bookNumber, chapter, verseIds, modules, provider).catch(() => {
              // No cross-reference module installed is the common case, and it
              // must not take the rest of Study mode down with it.
              return new Map<number, ModuleCrossReferences[]>();
            })
          : Promise.resolve(new Map<number, ModuleCrossReferences[]>()),
        loadVerseLinks(verseIds).catch(error => {
          console.error('[useChapterStudyData] Error loading verse links:', error);
          return new Map<number, VerseLinksSummary>();
        }),
      ]);

      if (cancelled) return;
      setData({ crossRefsByVerse, linksByVerse, resolved: true });
    };

    void load().catch(error => {
      console.error('[useChapterStudyData] Chapter load failed:', error);
      // Resolved either way: a failed load must still let the verses paint,
      // un-adorned, rather than leaving the chapter blank forever.
      if (!cancelled) setData({ ...EMPTY, resolved: true });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verseKey, bookNumber, chapter, showCrossRefs, provider]);

  return data;
}
