import { DownloadProgress } from '../Data/Core/CatalogTypes';

/**
 * Callback function for download progress updates
 */
export type DownloadProgressCallback = (progress: DownloadProgress) => void;

/**
 * Callback function for download completion
 */
export type DownloadCompleteCallback = (queueId: number, filePath: string) => void;

/**
 * Callback function for download errors
 */
export type DownloadErrorCallback = (queueId: number, error: Error) => void;

/**
 * Download service interface
 * Handles HTTP downloads with progress tracking, pause/resume, and verification
 */
export interface IDownloadService {
  /**
   * Start a download
   * @param queueId - Download queue ID
   * @param url - URL to download from
   * @param destination - Local file path to save to
   * @param expectedChecksum - Expected SHA-256 checksum (optional)
   * @returns Promise that resolves with the downloaded file path
   */
  startDownload(
    queueId: number,
    url: string,
    destination: string,
    expectedChecksum?: string
  ): Promise<string>;

  /**
   * Pause a download
   * @param queueId - Download queue ID
   */
  pauseDownload(queueId: number): void;

  /**
   * Resume a paused download
   * @param queueId - Download queue ID
   */
  resumeDownload(queueId: number): Promise<void>;

  /**
   * Cancel a download
   * @param queueId - Download queue ID
   */
  cancelDownload(queueId: number): void;

  /**
   * Get current download progress
   * @param queueId - Download queue ID
   */
  getProgress(queueId: number): DownloadProgress | undefined;

  /**
   * Verify file checksum
   * @param filePath - Path to file
   * @param expectedChecksum - Expected SHA-256 checksum
   * @returns True if checksum matches
   */
  verifyChecksum(filePath: string, expectedChecksum: string): Promise<boolean>;

  /**
   * Register progress callback
   */
  onProgress(callback: DownloadProgressCallback): void;

  /**
   * Unregister a progress callback previously passed to `onProgress`.
   *
   * Required for any caller that subscribes per-download rather than once at
   * startup (the feature-pack installer does): without it every install leaks a
   * closure, and later installs fan their progress out to the stale callbacks
   * of earlier ones. Passing a callback that was never registered is a no-op.
   */
  offProgress(callback: DownloadProgressCallback): void;

  /**
   * Register completion callback
   */
  onComplete(callback: DownloadCompleteCallback): void;

  /**
   * Register error callback
   */
  onError(callback: DownloadErrorCallback): void;

  /**
   * Get all active downloads
   */
  getActiveDownloads(): DownloadProgress[];

  /**
   * Clear completed downloads from tracking
   */
  clearCompleted(): void;
}
