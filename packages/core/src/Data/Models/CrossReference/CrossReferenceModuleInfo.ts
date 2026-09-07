import { BaseModuleInfo, BaseModuleInfoData } from '../BaseModuleInfo';

/**
 * Cross-reference module information from the module_info table.
 * Stored within each cross-reference module database (xref_*.db).
 */
export class CrossReferenceModuleInfo extends BaseModuleInfo {
  readonly moduleType = 'cross_reference' as const;

  constructor(data: BaseModuleInfoData & {
    moduleType?: 'cross_reference';
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
