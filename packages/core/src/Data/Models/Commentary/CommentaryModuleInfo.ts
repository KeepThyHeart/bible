import { BaseModuleInfo, BaseModuleInfoData } from '../BaseModuleInfo';

/**
 * Commentary module information from the module_info table.
 * Stored within each commentary module database (commentary_*.db).
 */
export class CommentaryModuleInfo extends BaseModuleInfo {
  readonly moduleType = 'commentary' as const;

  constructor(data: BaseModuleInfoData & {
    moduleType?: 'commentary';
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

  /** Get publication info string. */
  getPublicationInfo(): string {
    const parts: string[] = [];
    if (this.author) parts.push(this.author);
    if (this.yearPublished) parts.push(this.yearPublished.toString());
    return parts.join(', ');
  }
}
