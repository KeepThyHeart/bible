import { ISql } from '../Core/ISql';
import { RepositoryQueryOptions } from '../Core/IRepository';
import { DownloadQueue, DownloadStatus } from '../Models/Main/DownloadQueue';
import { IDownloadQueueRepository } from './IDownloadQueueRepository';
import { DownloadQueueRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';
import { buildSafeOrderBy, buildPagination } from '../Core/SafeQuery';

/**
 * Repository for download queue entities
 * Manages module downloads in progress
 */
export class DownloadQueueRepository implements IDownloadQueueRepository {
  private static readonly ALLOWED_ORDER_COLUMNS = new Set(['started_date', 'completed_date', 'status', 'module_name']);

  constructor(private sql: ISql) {}

  /**
   * Get a download by ID
   */
  getById(id: number): DownloadQueue | undefined {
    const row = this.sql.queryOne<DownloadQueueRow>(
      'SELECT * FROM module_download_queue WHERE queue_id = ?',
      [id]
    );

    return row ? this.mapRowToEntity(row) : undefined;
  }

  /**
   * Get download by module ID
   */
  getByModuleId(moduleId: string): DownloadQueue | undefined {
    const row = this.sql.queryOne<DownloadQueueRow>(
      'SELECT * FROM module_download_queue WHERE module_id = ? ORDER BY started_date DESC LIMIT 1',
      [moduleId]
    );

    return row ? this.mapRowToEntity(row) : undefined;
  }

  /**
   * Get all downloads
   */
  getAll(options?: RepositoryQueryOptions): DownloadQueue[] {
    let sql = 'SELECT * FROM module_download_queue';

    sql += buildSafeOrderBy(
      options?.orderBy,
      options?.orderDirection,
      DownloadQueueRepository.ALLOWED_ORDER_COLUMNS,
      { column: 'started_date', direction: 'DESC' }
    );

    sql += buildPagination(options?.limit, options?.offset);

    const rows = this.sql.queryAll<DownloadQueueRow>(sql);
    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get downloads by status
   */
  getByStatus(status: DownloadStatus): DownloadQueue[] {
    const rows = this.sql.queryAll<DownloadQueueRow>(
      'SELECT * FROM module_download_queue WHERE status = ? ORDER BY started_date DESC',
      [status]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get active downloads (pending or downloading)
   */
  getActive(): DownloadQueue[] {
    const rows = this.sql.queryAll<DownloadQueueRow>(
      `SELECT * FROM module_download_queue
       WHERE status IN ('pending', 'downloading')
       ORDER BY started_date DESC`
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Create a new download
   */
  create(entity: DownloadQueue): DownloadQueue {
    const result = this.sql.execute(
      `INSERT INTO module_download_queue (
        module_id, module_name, download_url, download_size_bytes, status,
        progress_bytes, download_speed_bps, started_date, completed_date,
        error_message, retry_count, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.moduleId,
        entity.moduleName,
        entity.downloadUrl,
        entity.downloadSizeBytes ?? null,
        entity.status,
        entity.progressBytes,
        entity.downloadSpeedBps ?? null,
        entity.startedDate ?? null,
        entity.completedDate ?? null,
        entity.errorMessage ?? null,
        entity.retryCount,
        stringifyJsonField(entity.metadata)
      ]
    );

    entity.queueId = result.lastInsertRowId;
    return entity;
  }

  /**
   * Update an existing download
   */
  update(entity: DownloadQueue): DownloadQueue {
    if (!entity.queueId) {
      throw new Error('Cannot update download without ID');
    }

    this.sql.execute(
      `UPDATE module_download_queue SET
        module_id = ?, module_name = ?, download_url = ?, download_size_bytes = ?,
        status = ?, progress_bytes = ?, download_speed_bps = ?, started_date = ?,
        completed_date = ?, error_message = ?, retry_count = ?, metadata = ?
      WHERE queue_id = ?`,
      [
        entity.moduleId,
        entity.moduleName,
        entity.downloadUrl,
        entity.downloadSizeBytes ?? null,
        entity.status,
        entity.progressBytes,
        entity.downloadSpeedBps ?? null,
        entity.startedDate ?? null,
        entity.completedDate ?? null,
        entity.errorMessage ?? null,
        entity.retryCount,
        stringifyJsonField(entity.metadata),
        entity.queueId
      ]
    );

    return entity;
  }

  /**
   * Delete a download
   */
  delete(id: number): boolean {
    const result = this.sql.execute(
      'DELETE FROM module_download_queue WHERE queue_id = ?',
      [id]
    );
    return result.changes > 0;
  }

  /**
   * Update download progress
   */
  updateProgress(queueId: number, progressBytes: number, speedBps?: number): void {
    this.sql.execute(
      `UPDATE module_download_queue
       SET progress_bytes = ?, download_speed_bps = ?
       WHERE queue_id = ?`,
      [progressBytes, speedBps ?? null, queueId]
    );
  }

  /**
   * Update download status
   */
  updateStatus(queueId: number, status: DownloadStatus, errorMessage?: string): void {
    const now = new Date().toISOString();

    if (status === 'downloading') {
      this.sql.execute(
        `UPDATE module_download_queue
         SET status = ?, started_date = COALESCE(started_date, ?), error_message = ?
         WHERE queue_id = ?`,
        [status, now, errorMessage ?? null, queueId]
      );
    } else if (status === 'completed') {
      this.sql.execute(
        `UPDATE module_download_queue
         SET status = ?, completed_date = ?, error_message = ?
         WHERE queue_id = ?`,
        [status, now, errorMessage ?? null, queueId]
      );
    } else {
      this.sql.execute(
        `UPDATE module_download_queue
         SET status = ?, error_message = ?
         WHERE queue_id = ?`,
        [status, errorMessage ?? null, queueId]
      );
    }
  }

  /**
   * Clear completed downloads
   */
  clearCompleted(): number {
    const result = this.sql.execute(
      'DELETE FROM module_download_queue WHERE status = ?',
      ['completed']
    );
    return result.changes;
  }

  /**
   * Cancel download
   */
  cancel(queueId: number): void {
    this.sql.execute(
      `UPDATE module_download_queue
       SET status = 'failed', error_message = 'Cancelled by user'
       WHERE queue_id = ?`,
      [queueId]
    );
  }

  /**
   * Map database row to DownloadQueue entity
   */
  private mapRowToEntity(row: DownloadQueueRow): DownloadQueue {
    return new DownloadQueue({
      queueId: row.queue_id,
      moduleId: String(row.module_id ?? ''),
      moduleName: row.module_name,
      downloadUrl: row.download_url,
      downloadSizeBytes: row.download_size_bytes,
      status: row.status as DownloadStatus,
      progressBytes: row.progress_bytes,
      downloadSpeedBps: row.download_speed_bps,
      startedDate: row.started_date,
      completedDate: row.completed_date,
      errorMessage: row.error_message,
      retryCount: row.retry_count,
      metadata: parseJsonField(row.metadata)
    });
  }
}
