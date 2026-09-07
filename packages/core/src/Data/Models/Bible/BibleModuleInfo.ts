import { BaseModuleInfo, BaseModuleInfoData } from '../BaseModuleInfo';

/**
 * Bible module information from the module_info table.
 * Stored within each Bible module database (bible_*.db).
 */
export class BibleModuleInfo extends BaseModuleInfo {
  readonly moduleType = 'bible' as const;

  constructor(data: BaseModuleInfoData & { moduleType?: 'bible' }) {
    super(data);
  }

  /** Get the full display name with year. */
  getDisplayName(): string {
    if (this.yearPublished) {
      return `${this.fullName} (${this.yearPublished})`;
    }
    return this.fullName;
  }

  /** Get publication info string. */
  getPublicationInfo(): string {
    const parts: string[] = [];
    if (this.publisher) parts.push(this.publisher);
    if (this.yearPublished) parts.push(this.yearPublished.toString());
    return parts.join(', ');
  }
}
