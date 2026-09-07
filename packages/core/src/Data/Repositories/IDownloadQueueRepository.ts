import { IRepository } from '../Core/IRepository';
import { DownloadQueue, DownloadStatus } from '../Models/Main/DownloadQueue';

/**
 * Repository interface for download queue entities
 */
export interface IDownloadQueueRepository extends IRepository<DownloadQueue> {
  /**
   * Get downloads by status
   */
  getByStatus(status: DownloadStatus): DownloadQueue[];

  /**
   * Get active downloads (pending or downloading)
   */
  getActive(): DownloadQueue[];

  /**
   * Update download progress
   */
  updateProgress(queueId: number, progressBytes: number, speedBps?: number): void;

  /**
   * Update download status
   */
  updateStatus(queueId: number, status: DownloadStatus, errorMessage?: string): void;

  /**
   * Clear completed downloads
   */
  clearCompleted(): number;

  /**
   * Get download by module ID
   */
  getByModuleId(moduleId: string): DownloadQueue | undefined;

  /**
   * Cancel download
   */
  cancel(queueId: number): void;
}
