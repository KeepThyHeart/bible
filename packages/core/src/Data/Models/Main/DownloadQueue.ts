import { Metadata } from '../../Core/Types';

/**
 * Download status
 */
export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';

/**
 * Download queue entity from the main database
 * Tracks module downloads in progress
 */
export class DownloadQueue {
  queueId?: number;
  moduleId: string;
  moduleName: string;
  downloadUrl: string;
  downloadSizeBytes?: number;
  status: DownloadStatus;
  progressBytes: number;
  downloadSpeedBps?: number;
  startedDate?: string;
  completedDate?: string;
  errorMessage?: string;
  retryCount: number;
  metadata?: Metadata;

  constructor(data: {
    queueId?: number;
    moduleId: string;
    moduleName: string;
    downloadUrl: string;
    downloadSizeBytes?: number;
    status?: DownloadStatus;
    progressBytes?: number;
    downloadSpeedBps?: number;
    startedDate?: string;
    completedDate?: string;
    errorMessage?: string;
    retryCount?: number;
    metadata?: Metadata;
  }) {
    this.queueId = data.queueId;
    this.moduleId = data.moduleId;
    this.moduleName = data.moduleName;
    this.downloadUrl = data.downloadUrl;
    this.downloadSizeBytes = data.downloadSizeBytes;
    this.status = data.status ?? 'pending';
    this.progressBytes = data.progressBytes ?? 0;
    this.downloadSpeedBps = data.downloadSpeedBps;
    this.startedDate = data.startedDate;
    this.completedDate = data.completedDate;
    this.errorMessage = data.errorMessage;
    this.retryCount = data.retryCount ?? 0;
    this.metadata = data.metadata;
  }

  /**
   * Get download progress percentage (0-100)
   */
  getProgressPercentage(): number {
    if (!this.downloadSizeBytes || this.downloadSizeBytes === 0) {
      return 0;
    }
    return Math.min(100, (this.progressBytes / this.downloadSizeBytes) * 100);
  }

  /**
   * Get remaining bytes to download
   */
  getRemainingBytes(): number {
    if (!this.downloadSizeBytes) {
      return 0;
    }
    return Math.max(0, this.downloadSizeBytes - this.progressBytes);
  }

  /**
   * Get download speed in MB/s
   */
  getSpeedMBps(): number {
    if (!this.downloadSpeedBps) {
      return 0;
    }
    return this.downloadSpeedBps / (1024 * 1024);
  }

  /**
   * Get estimated time remaining in seconds
   */
  getEstimatedTimeRemaining(): number | undefined {
    if (!this.downloadSpeedBps || this.downloadSpeedBps === 0) {
      return undefined;
    }
    const remaining = this.getRemainingBytes();
    return remaining / this.downloadSpeedBps;
  }

  /**
   * Check if download is active (downloading or pending)
   */
  isActive(): boolean {
    return this.status === 'downloading' || this.status === 'pending';
  }

  /**
   * Check if download can be retried
   */
  canRetry(): boolean {
    return this.status === 'failed' && this.retryCount < 3;
  }

  /**
   * Mark as started
   */
  markStarted(): void {
    this.status = 'downloading';
    this.startedDate = new Date().toISOString();
  }

  /**
   * Mark as completed
   */
  markCompleted(): void {
    this.status = 'completed';
    this.completedDate = new Date().toISOString();
    this.progressBytes = this.downloadSizeBytes ?? this.progressBytes;
  }

  /**
   * Mark as failed with error message
   */
  markFailed(error: string): void {
    this.status = 'failed';
    this.errorMessage = error;
    this.retryCount++;
  }

  /**
   * Update progress
   */
  updateProgress(bytes: number, speedBps?: number): void {
    this.progressBytes = bytes;
    if (speedBps !== undefined) {
      this.downloadSpeedBps = speedBps;
    }
  }
}
