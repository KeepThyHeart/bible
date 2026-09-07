import { BaseModuleInfo, BaseModuleInfoData } from '../BaseModuleInfo';

/**
 * Devotional module types
 */
export type DevotionalType = 'day_of_year' | 'fixed_length' | 'continuous';

/**
 * Devotional module information from the module_info table.
 * Stored within each devotional module database (devotional_*.db).
 */
export class DevotionalModuleInfo extends BaseModuleInfo {
  readonly moduleType = 'devotional' as const;
  devotionalType: DevotionalType;
  totalDays?: number;

  constructor(data: BaseModuleInfoData & {
    moduleType?: 'devotional';
    devotionalType: DevotionalType;
    totalDays?: number;
  }) {
    super(data);
    this.devotionalType = data.devotionalType;
    this.totalDays = data.totalDays;
  }

  /** Get the full display name with author. */
  getDisplayName(): string {
    if (this.author) {
      return `${this.fullName} by ${this.author}`;
    }
    return this.fullName;
  }

  /** Get a description of the devotional type. */
  getTypeDescription(): string {
    switch (this.devotionalType) {
      case 'day_of_year':
        return `Daily (${this.totalDays ?? 365} days)`;
      case 'fixed_length':
        return `${this.totalDays}-day devotional`;
      case 'continuous':
        return 'Continuous reading';
    }
  }

  /** Check if this is a daily devotional (365/366 days). */
  isDailyDevotional(): boolean {
    return this.devotionalType === 'day_of_year';
  }

  /** Check if this has a fixed length. */
  isFixedLength(): boolean {
    return this.devotionalType === 'fixed_length';
  }

  /** Check if this is continuous (no specific timeframe). */
  isContinuous(): boolean {
    return this.devotionalType === 'continuous';
  }

  /** Get the duration description. */
  getDurationDescription(): string {
    if (this.totalDays) {
      return `${this.totalDays} days`;
    }
    return 'Continuous';
  }
}
