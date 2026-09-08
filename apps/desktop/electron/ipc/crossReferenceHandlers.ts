import { IpcMain } from 'electron';
import { CrossReferenceRepository } from '@bible/core';
import { getSharedModuleMetadataRepo } from '../services/sharedMainDb';
import { ModuleLoader } from '../services/ModuleLoader';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { validateAbbreviation, validateVerseId } from '../utils/validation';

const loader = new ModuleLoader('cross_reference', (db) => new CrossReferenceRepository(db));

function getXrefRepository(abbreviation: string): CrossReferenceRepository | null {
  return loader.get(abbreviation);
}

interface XrefModuleSummary {
  module_id: number | undefined;
  abbreviation: string;
  name: string;
  language_code: string | undefined;
  version: string | undefined;
  database_path: string;
}

interface XrefGroupDto {
  group_id: number | undefined;
  verse_id: number;
  /** End of the group's source passage (inclusive); equals `verse_id` for a single verse. */
  verse_id_end: number;
  phrase: string | undefined;
  sort_order: number | undefined;
  metadata: unknown;
}

interface XrefEntryDto {
  entry_id: number | undefined;
  group_id: number | undefined;
  target_verse_id: number;
  target_verse_end_id: number | undefined;
  note: string | undefined;
  sort_order: number | undefined;
  metadata: unknown;
}

interface XrefGroupWithEntries {
  group: XrefGroupDto;
  entries: XrefEntryDto[];
}

interface XrefReverseRefDto {
  source_verse_id: number;
  phrase: string | undefined;
  note: string | undefined;
}

/**
 * A reverse reference plus the passage it cites, so one chapter-wide reply can
 * be split per verse in the renderer.
 */
interface XrefRangeReverseRefDto extends XrefReverseRefDto {
  target_verse_id_start: number;
  target_verse_id_end: number;
}

export function registerCrossReferenceHandlers(_ipcMain: IpcMain): void {

  // Get available cross-reference modules
  ipcHandler<[], XrefModuleSummary[]>('xref:getAvailable', async () => {
    const moduleMetadataRepo = getSharedModuleMetadataRepo();
    const modules = moduleMetadataRepo.getByType('cross_reference');
    return modules.map(mod => ({
      module_id: mod.moduleId,
      abbreviation: mod.abbreviation || mod.getAbbreviation(),
      name: mod.moduleName,
      language_code: mod.languageCode,
      version: mod.version,
      database_path: mod.databasePath
    }));
  });

  // Get phrase-grouped cross-references for a verse (with entries)
  ipcHandler<[string, number], XrefGroupWithEntries[]>('xref:getGroupsForVerse', async (abbreviation, verseId) => {
    validateAbbreviation(abbreviation);
    validateVerseId(verseId);
    const repo = getXrefRepository(abbreviation);
    if (!repo) throw new IpcKnownError('not_found', `Cross-reference module not found: ${abbreviation}`);

    const groupsWithEntries = repo.getGroupsWithEntries(verseId);
    return groupsWithEntries.map(({ group, entries }) => ({
      group: {
        group_id: group.groupId,
        verse_id: group.verseId,
        verse_id_end: group.verseIdEnd,
        phrase: group.phrase,
        sort_order: group.sortOrder,
        metadata: group.metadata
      },
      entries: entries.map(e => ({
        entry_id: e.entryId,
        group_id: e.groupId,
        target_verse_id: e.targetVerseId,
        target_verse_end_id: e.targetVerseEndId,
        note: e.note,
        sort_order: e.sortOrder,
        metadata: e.metadata
      }))
    }));
  });

  // Phrase-grouped cross-references for a whole verse RANGE (one chapter).
  //
  // Study mode asked `xref:getGroupsForVerse` once per verse per module - ~31
  // round trips for a chapter - and each reply arrived at a different moment,
  // so the pane visibly reflowed as they landed. This is the same data in one
  // call, tagged with each group's own anchor range so the renderer can
  // attribute a group to the verses it covers.
  ipcHandler<[string, number, number], XrefGroupWithEntries[]>(
    'xref:getGroupsForRange',
    async (abbreviation, startVerseId, endVerseId) => {
      validateAbbreviation(abbreviation);
      validateVerseId(startVerseId);
      validateVerseId(endVerseId);
      const repo = getXrefRepository(abbreviation);
      if (!repo) throw new IpcKnownError('not_found', `Cross-reference module not found: ${abbreviation}`);

      const groupsWithEntries = repo.getGroupsWithEntriesForRange(startVerseId, endVerseId);
      return groupsWithEntries.map(({ group, entries }) => ({
        group: {
          group_id: group.groupId,
          verse_id: group.verseId,
          verse_id_end: group.verseIdEnd,
          phrase: group.phrase,
          sort_order: group.sortOrder,
          metadata: group.metadata
        },
        entries: entries.map(e => ({
          entry_id: e.entryId,
          group_id: e.groupId,
          target_verse_id: e.targetVerseId,
          target_verse_end_id: e.targetVerseEndId,
          note: e.note,
          sort_order: e.sortOrder,
          metadata: e.metadata
        }))
      }));
    }
  );

  // Reverse lookup for a whole verse RANGE - the "Cited in" row's data for one
  // chapter in a single call, instead of one call per verse per module.
  ipcHandler<[string, number, number], XrefRangeReverseRefDto[]>(
    'xref:getReverseReferencesForRange',
    async (abbreviation, startVerseId, endVerseId) => {
      validateAbbreviation(abbreviation);
      validateVerseId(startVerseId);
      validateVerseId(endVerseId);
      const repo = getXrefRepository(abbreviation);
      if (!repo) throw new IpcKnownError('not_found', `Cross-reference module not found: ${abbreviation}`);

      return repo.getReverseReferencesForRange(startVerseId, endVerseId).map(r => ({
        source_verse_id: r.sourceVerseId,
        phrase: r.phrase,
        note: r.note,
        target_verse_id_start: r.targetVerseIdStart,
        target_verse_id_end: r.targetVerseIdEnd
      }));
    }
  );

  // Reverse lookup: where is this verse referenced?
  ipcHandler<[string, number], XrefReverseRefDto[]>('xref:getReverseReferences', async (abbreviation, verseId) => {
    validateAbbreviation(abbreviation);
    validateVerseId(verseId);
    const repo = getXrefRepository(abbreviation);
    if (!repo) throw new IpcKnownError('not_found', `Cross-reference module not found: ${abbreviation}`);

    const refs = repo.getReverseReferences(verseId);
    return refs.map(r => ({
      source_verse_id: r.sourceVerseId,
      phrase: r.phrase,
      note: r.note
    }));
  });

  // Entry count for a verse (for badge display)
  ipcHandler<[string, number], number>('xref:getEntryCount', async (abbreviation, verseId) => {
    validateAbbreviation(abbreviation);
    validateVerseId(verseId);
    const repo = getXrefRepository(abbreviation);
    if (!repo) throw new IpcKnownError('not_found', `Cross-reference module not found: ${abbreviation}`);

    return repo.getEntryCount(verseId);
  });
}

/**
 * Clean up cross-reference database connections
 */
export function closeXrefDbs(): void {
  loader.closeAll();
}
