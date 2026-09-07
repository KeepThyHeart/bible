import { BaseModuleInfo, BaseModuleInfoData } from '../BaseModuleInfo';

/**
 * Topical index module information from the module_info table.
 * Stored within each topical index module database (topical_*.db).
 */
export class TopicalIndexModuleInfo extends BaseModuleInfo {
  readonly moduleType = 'topical_index' as const;

  constructor(data: BaseModuleInfoData & {
    moduleType?: 'topical_index';
  }) {
    super(data);
  }

  /** Get display name with author if available. */
  getDisplayName(): string {
    if (this.author) {
      return `${this.fullName} by ${this.author}`;
    }
    return this.fullName;
  }
}
