import { VerseId, Metadata } from '../../Core/Types';

/**
 * Individual cross-reference entry within a group (from a cross_reference module database).
 * Named ModuleCrossRefEntry to distinguish from the user CrossReferenceEntry in VerseLinksService.
 */
export class ModuleCrossRefEntry {
  entryId?: number;
  groupId: number;
  targetVerseId: VerseId;
  targetVerseEndId?: VerseId;
  note?: string;
  sortOrder?: number;
  metadata?: Metadata;

  constructor(data: {
    entryId?: number;
    groupId: number;
    targetVerseId: VerseId;
    targetVerseEndId?: VerseId;
    note?: string;
    sortOrder?: number;
    metadata?: Metadata;
  }) {
    this.entryId = data.entryId;
    this.groupId = data.groupId;
    this.targetVerseId = data.targetVerseId;
    this.targetVerseEndId = data.targetVerseEndId;
    this.note = data.note;
    this.sortOrder = data.sortOrder;
    this.metadata = data.metadata;
  }

  /**
   * Check if this entry represents a verse range
   */
  isRange(): boolean {
    return this.targetVerseEndId !== undefined && this.targetVerseEndId !== null;
  }
}
