import { Metadata } from '../../Core/Types';

/**
 * Module update entity from the main database
 * Represents an available update for an installed module
 */
export class ModuleUpdate {
  updateId?: number;
  moduleId: number;
  currentVersion: string;
  availableVersion: string;
  releaseDate?: string;
  changelog?: string;
  downloadUrl: string;
  downloadSizeBytes?: number;
  isCritical: boolean;
  userIgnored: boolean;
  notifiedDate?: string;
  metadata?: Metadata;

  constructor(data: {
    updateId?: number;
    moduleId: number;
    currentVersion: string;
    availableVersion: string;
    releaseDate?: string;
    changelog?: string;
    downloadUrl: string;
    downloadSizeBytes?: number;
    isCritical?: boolean;
    userIgnored?: boolean;
    notifiedDate?: string;
    metadata?: Metadata;
  }) {
    this.updateId = data.updateId;
    this.moduleId = data.moduleId;
    this.currentVersion = data.currentVersion;
    this.availableVersion = data.availableVersion;
    this.releaseDate = data.releaseDate;
    this.changelog = data.changelog;
    this.downloadUrl = data.downloadUrl;
    this.downloadSizeBytes = data.downloadSizeBytes;
    this.isCritical = data.isCritical ?? false;
    this.userIgnored = data.userIgnored ?? false;
    this.notifiedDate = data.notifiedDate;
    this.metadata = data.metadata;
  }

  /**
   * Get download size in MB
   */
  getSizeMB(): number {
    return this.downloadSizeBytes ? this.downloadSizeBytes / (1024 * 1024) : 0;
  }

  /**
   * Check if this update is newer (semver comparison)
   */
  isNewer(): boolean {
    return this.compareVersions(this.availableVersion, this.currentVersion) > 0;
  }

  /**
   * Simple semver comparison
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }

    return 0;
  }

  /**
   * Mark as ignored by user
   */
  ignore(): void {
    this.userIgnored = true;
  }

  /**
   * Mark as notified
   */
  markNotified(): void {
    this.notifiedDate = new Date().toISOString();
  }

  /**
   * Get formatted version comparison
   */
  getVersionComparison(): string {
    return `${this.currentVersion} → ${this.availableVersion}`;
  }
}
