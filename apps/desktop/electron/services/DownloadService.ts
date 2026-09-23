import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ClientRequest } from 'electron';
import type { DownloadProgress } from '@bible/core';
import type {
  IDownloadService,
  DownloadProgressCallback,
  DownloadCompleteCallback,
  DownloadErrorCallback
} from '@bible/core';
import { parseHttpUrl } from '../utils/networkPolicy';
import {
  getNetworkGateway,
  type INetworkGateway,
  type DownloadStreamResult,
} from './NetworkGateway';

/**
 * Download state for tracking active downloads
 */
interface DownloadState {
  queueId: number;
  url: string;
  destination: string;
  expectedChecksum?: string;
  bytesDownloaded: number;
  totalBytes?: number;
  speedBps: number;
  status: 'downloading' | 'paused' | 'cancelled';
  lastProgressTime: number;
  request?: ClientRequest;
  writeStream?: fs.WriteStream;
}

/**
 * Download service implementation
 * Handles HTTP downloads with progress tracking, pause/resume, and verification.
 *
 * Network egress goes through the injected `NetworkGateway` (Electron `net`,
 * proxy-honoring). The gateway owns redirect/scheme/downgrade policy and the
 * master offline switch; this service drives the returned stream to disk and
 * keeps all Range/resume/progress bookkeeping.
 */
export class DownloadService implements IDownloadService {
  private downloads: Map<number, DownloadState> = new Map();
  private progressCallbacks: DownloadProgressCallback[] = [];
  private completeCallbacks: DownloadCompleteCallback[] = [];
  private errorCallbacks: DownloadErrorCallback[] = [];
  private readonly gateway: INetworkGateway;

  constructor(gateway: INetworkGateway = getNetworkGateway()) {
    this.gateway = gateway;
  }

  /**
   * Start a download.
   *
   * Obtains a streaming response from the `NetworkGateway`, which enforces the
   * redirect hop limit, refuses an https -> http downgrade, and honors the
   * master offline switch. This service then streams the response to disk with
   * Range-based resume and progress tracking.
   */
  async startDownload(
    queueId: number,
    url: string,
    destination: string,
    expectedChecksum?: string
  ): Promise<string> {
    // Reject a duplicate queue slot up front.
    if (this.downloads.has(queueId)) {
      throw new Error(`Download ${queueId} already in progress`);
    }

    // Validate the scheme before touching the gateway so a `file:`/custom-URL
    // is rejected without reserving a queue slot. (The gateway re-checks.)
    parseHttpUrl(url, 'download');

    // Create download state
    const state: DownloadState = {
      queueId,
      url,
      destination,
      expectedChecksum,
      bytesDownloaded: 0,
      speedBps: 0,
      status: 'downloading',
      lastProgressTime: Date.now()
    };
    this.downloads.set(queueId, state);

    // Resume support: if a partial file exists, request the remaining bytes.
    let startByte = 0;
    if (fs.existsSync(destination)) {
      const stats = fs.statSync(destination);
      startByte = stats.size;
      state.bytesDownloaded = startByte;
    }
    const headers = startByte > 0 ? { Range: `bytes=${startByte}-` } : undefined;

    let stream: DownloadStreamResult;
    try {
      stream = await this.gateway.downloadStream({
        url,
        ...(headers ? { headers } : {}),
        context: 'download'
      });
    } catch (error) {
      // Redirect-limit / downgrade / offline / connection errors surface here.
      // Free the queue slot so a retry doesn't hit "already in progress" - the
      // failed hop must not leave a phantom entry behind.
      this.downloads.delete(queueId);
      throw error as Error;
    }

    return this.consumeStream(state, stream, expectedChecksum, startByte);
  }

  /**
   * Drive a gateway-supplied response stream to disk. Kept separate from
   * request setup so the Range/resume/progress/checksum bookkeeping is easy to
   * follow. The gateway hands us a still-paused stream; attaching the `data`
   * listener here is what starts the flow, so no bytes are lost.
   */
  private consumeStream(
    state: DownloadState,
    stream: DownloadStreamResult,
    expectedChecksum: string | undefined,
    startByte: number
  ): Promise<string> {
    const { queueId, destination } = state;
    const { status, headers, response, request } = stream;
    state.request = request;

    return new Promise<string>((resolve, reject) => {
      // Check for successful response
      if (status !== 200 && status !== 206) {
        const error = new Error(`Download failed with status ${status}`);
        this.handleError(queueId, error);
        reject(error);
        return;
      }

      // Get total size
      const contentLength = headers['content-length'];
      if (contentLength) {
        const len = Array.isArray(contentLength) ? contentLength[0] : contentLength;
        state.totalBytes = parseInt(len, 10) + startByte;
      }

      // The download directory is not created anywhere else, and a fresh
      // profile has none - without this, every first install fails with ENOENT.
      fs.mkdirSync(path.dirname(destination), { recursive: true });

      // Create write stream (append mode if resuming)
      const writeStream = fs.createWriteStream(destination, {
        flags: startByte > 0 ? 'a' : 'w'
      });
      state.writeStream = writeStream;

      // Track progress
      let lastProgressUpdate = Date.now();
      let bytesInInterval = 0;

      response.on('data', (chunk: Buffer) => {
        // `pause`/`cancel` abort the underlying request (see pause/cancel
        // methods), which tears down the stream. Electron's IncomingMessage
        // exposes no pause()/destroy(), so we simply drop any in-flight chunk
        // once the download is no longer active.
        if (state.status === 'cancelled' || state.status === 'paused') {
          return;
        }

        // Persist the chunk to disk. Electron's IncomingMessage does not
        // expose a usable pause()/backpressure knob, so we let Node's write
        // buffer absorb bursts (the network is the bottleneck for module
        // downloads). The prior implementation only *counted* bytes and never
        // wrote them, so every completed download was a zero-byte file.
        writeStream.write(chunk);

        state.bytesDownloaded += chunk.length;
        bytesInInterval += chunk.length;

        // Update speed every second
        const now = Date.now();
        const timeDiff = now - lastProgressUpdate;
        if (timeDiff >= 1000) {
          state.speedBps = Math.round((bytesInInterval / timeDiff) * 1000);
          bytesInInterval = 0;
          lastProgressUpdate = now;

          // Emit progress
          this.emitProgress(state);
        }
      });

      response.on('end', () => {
        // The whole body is wrapped because this listener is async: anything
        // that throws inside it would otherwise become an unhandled rejection
        // and leave the outer promise permanently pending - the caller hangs
        // rather than seeing the failure.
        void (async () => {
          try {
            // `end()` only *requests* the close; the bytes are not necessarily
            // on disk until 'finish' fires. Hashing before that read a
            // truncated file and failed verification on a download that was
            // actually fine - intermittently, and more often the larger the
            // trailing buffer.
            await new Promise<void>((done, fail) => {
              writeStream.once('finish', done);
              writeStream.once('error', fail);
              writeStream.end();
            });

            // Verify checksum if provided
            if (expectedChecksum) {
              const isValid = await this.verifyChecksum(destination, expectedChecksum);
              if (!isValid) {
                const error = new Error('Checksum verification failed');
                this.handleError(queueId, error);
                reject(error);
                return;
              }
            }

            // Clean up
            this.downloads.delete(queueId);

            // Emit completion
            this.completeCallbacks.forEach(cb => cb(queueId, destination));
            resolve(destination);
          } catch (err) {
            const error = err as Error;
            this.handleError(queueId, error);
            reject(error);
          }
        })();
      });

      response.on('error', (error: Error) => {
        writeStream.end();
        this.handleError(queueId, error);
        reject(error);
      });

      writeStream.on('error', (error: Error) => {
        // Abort the request to stop the incoming stream (Electron's
        // IncomingMessage has no destroy()).
        try {
          request.abort();
        } catch {
          /* ignore */
        }
        this.handleError(queueId, error);
        reject(error);
      });
    });
  }

  /**
   * Pause a download
   */
  pauseDownload(queueId: number): void {
    const state = this.downloads.get(queueId);
    if (state) {
      state.status = 'paused';
      if (state.request) {
        state.request.abort();
      }
      if (state.writeStream) {
        state.writeStream.end();
      }
    }
  }

  /**
   * Resume a paused download
   */
  async resumeDownload(queueId: number): Promise<void> {
    const state = this.downloads.get(queueId);
    if (!state || state.status !== 'paused') {
      throw new Error('Download not found or not paused');
    }

    // Remove old state and restart
    this.downloads.delete(queueId);
    await this.startDownload(queueId, state.url, state.destination, state.expectedChecksum);
  }

  /**
   * Cancel a download
   */
  cancelDownload(queueId: number): void {
    const state = this.downloads.get(queueId);
    if (state) {
      state.status = 'cancelled';
      if (state.request) {
        state.request.abort();
      }
      if (state.writeStream) {
        state.writeStream.end();
      }
      this.downloads.delete(queueId);

      // Delete partial file
      if (fs.existsSync(state.destination)) {
        fs.unlinkSync(state.destination);
      }
    }
  }

  /**
   * Get current download progress
   */
  getProgress(queueId: number): DownloadProgress | undefined {
    const state = this.downloads.get(queueId);
    if (!state) {
      return undefined;
    }

    return this.stateToProgress(state);
  }

  /**
   * Verify file checksum
   */
  async verifyChecksum(filePath: string, expectedChecksum: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => {
        hash.update(chunk);
      });

      stream.on('end', () => {
        const actualChecksum = hash.digest('hex');
        resolve(actualChecksum.toLowerCase() === expectedChecksum.toLowerCase());
      });

      stream.on('error', reject);
    });
  }

  /**
   * Register progress callback
   */
  onProgress(callback: DownloadProgressCallback): void {
    this.progressCallbacks.push(callback);
  }

  /**
   * Unregister a progress callback. No-op if it was never registered.
   */
  offProgress(callback: DownloadProgressCallback): void {
    const index = this.progressCallbacks.indexOf(callback);
    if (index !== -1) {
      this.progressCallbacks.splice(index, 1);
    }
  }

  /**
   * Register completion callback
   */
  onComplete(callback: DownloadCompleteCallback): void {
    this.completeCallbacks.push(callback);
  }

  /**
   * Register error callback
   */
  onError(callback: DownloadErrorCallback): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * Get all active downloads
   */
  getActiveDownloads(): DownloadProgress[] {
    const downloads: DownloadProgress[] = [];
    this.downloads.forEach((state) => {
      downloads.push(this.stateToProgress(state));
    });
    return downloads;
  }

  /**
   * Clear completed downloads from tracking
   */
  clearCompleted(): void {
    // Nothing to clear as completed downloads are automatically removed
  }

  /**
   * Emit progress to all callbacks
   */
  private emitProgress(state: DownloadState): void {
    const progress = this.stateToProgress(state);
    this.progressCallbacks.forEach(cb => cb(progress));
  }

  /**
   * Handle download error
   */
  private handleError(queueId: number, error: Error): void {
    const state = this.downloads.get(queueId);
    if (state) {
      if (state.writeStream) {
        state.writeStream.end();
      }
      this.downloads.delete(queueId);
    }

    this.errorCallbacks.forEach(cb => cb(queueId, error));
  }

  /**
   * Convert download state to progress object
   */
  private stateToProgress(state: DownloadState): DownloadProgress {
    const progressPercentage = state.totalBytes
      ? (state.bytesDownloaded / state.totalBytes) * 100
      : 0;

    const speedMBps = state.speedBps / (1024 * 1024);

    const estimatedTimeRemaining =
      state.speedBps > 0 && state.totalBytes
        ? (state.totalBytes - state.bytesDownloaded) / state.speedBps
        : undefined;

    return {
      queueId: state.queueId,
      moduleId: '', // Will be set by controller
      moduleName: '', // Will be set by controller
      status: state.status === 'paused' ? 'paused' : 'downloading',
      progressBytes: state.bytesDownloaded,
      totalBytes: state.totalBytes,
      progressPercentage,
      speedBps: state.speedBps,
      speedMBps,
      estimatedTimeRemaining
    };
  }
}
