import { BaseModuleInfo, BaseModuleInfoData } from '../BaseModuleInfo';

/**
 * Book module information from the module_info table.
 * Stored within each book module database (book_*.db).
 */
export class BookModuleInfo extends BaseModuleInfo {
  readonly moduleType = 'book' as const;

  constructor(data: BaseModuleInfoData & {
    moduleType?: 'book';
  }) {
    super(data);
  }

  /** Get the full display name with author. */
  getDisplayName(): string {
    if (this.author) {
      return `${this.fullName} by ${this.author}`;
    }
    return this.fullName;
  }

  /** Get citation format. */
  getCitation(): string {
    const parts: string[] = [];
    if (this.author) parts.push(this.author);
    parts.push(this.fullName);
    if (this.publisher) parts.push(this.publisher);
    if (this.yearPublished) parts.push(this.yearPublished.toString());
    return parts.join(', ');
  }
}
