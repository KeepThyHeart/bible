import { UserCrossReference } from '../Models/User/UserCrossReference';
import { VerseId } from '../Core/Types';

/**
 * Interface for User Cross-Reference repository
 * Handles user-created cross-references between Bible verses
 */
export interface IUserCrossReferenceRepository {
  // Retrieve operations
  getById(userXrefId: number): UserCrossReference | undefined;
  getForVerse(verseId: VerseId): UserCrossReference[];
  getFromVerse(fromVerseId: VerseId): UserCrossReference[];
  /**
   * Bulk variant of {@link getFromVerse}: every user cross-reference whose
   * origin falls inside the inclusive range. Lets Study mode price a whole
   * chapter's "My cross-references (N)" counts with one query.
   */
  getFromVerseRange(startVerseId: VerseId, endVerseId: VerseId): UserCrossReference[];
  getToVerse(toVerseId: VerseId): UserCrossReference[];
  getAll(): UserCrossReference[];

  // Create/Update/Delete operations
  create(xref: UserCrossReference): UserCrossReference;
  update(xref: UserCrossReference): UserCrossReference;
  delete(userXrefId: number): boolean;

  // Bulk operations
  deleteForVerse(verseId: VerseId): number;
}
