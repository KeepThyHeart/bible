import { BibleBook } from '../Models/Main/BibleBook';
import { ChapterInfo } from '../Models/Main/ChapterInfo';
import { Testament } from '../Core/Types';
import { RepositoryQueryOptions } from '../Core/IRepository';

/**
 * Interface for Bible Book repository
 * Defines all operations for working with Bible book metadata in the main database
 */
export interface IBibleBookRepository {
  getById(id: number): BibleBook | undefined;
  getByBookNumber(bookNumber: number): BibleBook | undefined;
  getByName(name: string): BibleBook | undefined;
  getAll(options?: RepositoryQueryOptions): BibleBook[];
  getByTestament(testament: Testament): BibleBook[];
  getByBookGroup(bookGroup: string): BibleBook[];

  create(entity: BibleBook): BibleBook;
  update(entity: BibleBook): BibleBook;
  delete(id: number): boolean;

  getTotalVerseCount(): number;
  search(query: string): BibleBook[];

  // Chapter Info
  getChapterInfo(bookId: number, chapter: number): ChapterInfo | undefined;
  getBookChapterInfo(bookId: number): ChapterInfo[];
  getChapterInfoByBookNumber(bookNumber: number): ChapterInfo[];
}
