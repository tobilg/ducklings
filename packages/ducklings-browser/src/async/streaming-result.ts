/**
 * Async Streaming Result class
 *
 * @packageDocumentation
 */

import { type Table, tableFromArrays } from '@uwdata/flechette';
import { DuckDBError } from '../errors.js';
import type { ColumnInfo } from '../types.js';
import { type DataChunkResponse, WorkerRequestType } from '../worker/protocol.js';
import type { DuckDB } from './bindings.js';
import { DataChunk } from './data-chunk.js';

/**
 * An async streaming query result.
 *
 * This class allows you to process large result sets in chunks,
 * which is more memory-efficient than loading everything at once.
 *
 * Implements AsyncIterable for use with `for await...of`.
 *
 * @category Query Results
 * @example
 * ```typescript
 * const stream = await conn.queryStreaming('SELECT * FROM large_table');
 *
 * // Using for await...of
 * for await (const chunk of stream) {
 *   console.log(`Processing ${chunk.rowCount} rows`);
 *   for (const row of chunk.toArray()) {
 *     processRow(row);
 *   }
 * }
 *
 * // Or manually
 * let chunk;
 * while ((chunk = await stream.nextChunk()) !== null) {
 *   console.log(chunk.rowCount);
 * }
 *
 * await stream.close();
 * ```
 */
export class AsyncStreamingResult implements AsyncIterable<DataChunk> {
  private db: DuckDB;
  private connectionId: number;
  private streamingResultId: number;
  private columns: ColumnInfo[];
  private closed = false;
  private done = false;

  /**
   * @internal
   */
  constructor(db: DuckDB, connectionId: number, streamingResultId: number, columns: ColumnInfo[]) {
    this.db = db;
    this.connectionId = connectionId;
    this.streamingResultId = streamingResultId;
    this.columns = columns;
  }

  /**
   * Get the column information for this result.
   */
  getColumns(): ColumnInfo[] {
    return this.columns;
  }

  /**
   * Check if the result has been fully consumed.
   */
  isDone(): boolean {
    return this.done;
  }

  /**
   * Check if the result is closed.
   */
  isClosed(): boolean {
    return this.closed;
  }

  private checkClosed(): void {
    if (this.closed) {
      throw new DuckDBError('Streaming result is closed');
    }
  }

  /**
   * Fetch the next chunk of data.
   *
   * @returns Promise resolving to the next DataChunk, or null if no more data
   */
  async nextChunk(): Promise<DataChunk | null> {
    this.checkClosed();

    if (this.done) {
      return null;
    }

    const response = await this.db.postTask<DataChunkResponse>(WorkerRequestType.FETCH_CHUNK, {
      connectionId: this.connectionId,
      streamingResultId: this.streamingResultId,
    });

    if (response.done && response.rowCount === 0) {
      this.done = true;
      return null;
    }

    if (response.done) {
      this.done = true;
    }

    return new DataChunk(response.columns, response.rows, response.rowCount);
  }

  /**
   * Collect all remaining chunks into an array of objects.
   *
   * Warning: This loads all data into memory. Use nextChunk() or
   * for await...of for large result sets.
   *
   * @returns Promise resolving to array of all result rows
   */
  async toArray<T = Record<string, unknown>>(): Promise<T[]> {
    const results: T[] = [];
    for await (const chunk of this) {
      results.push(...chunk.toArray<T>());
    }
    return results;
  }

  /**
   * Collect all remaining chunks into an Arrow Table.
   *
   * Warning: This loads all data into memory.
   *
   * @returns Promise resolving to Arrow Table with all results
   */
  async toArrowTable(): Promise<Table> {
    const allRows: unknown[][] = [];
    const columns = this.columns;

    for await (const chunk of this) {
      allRows.push(...chunk.getRows());
    }

    // Build column arrays
    const columnArrays: Record<string, unknown[]> = {};
    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
      const colName = columns[colIdx].name;
      columnArrays[colName] = allRows.map((row) => row[colIdx]);
    }

    return tableFromArrays(columnArrays);
  }

  /**
   * Close the streaming result and release resources.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    await this.db.postTask(WorkerRequestType.CLOSE_STREAMING_RESULT, {
      connectionId: this.connectionId,
      streamingResultId: this.streamingResultId,
    });
    this.closed = true;
  }

  // ============================================================================
  // AsyncIterable implementation
  // ============================================================================

  /**
   * Returns an async iterator for this streaming result.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<DataChunk> {
    try {
      let chunk = await this.nextChunk();
      while (chunk !== null) {
        yield chunk;
        chunk = await this.nextChunk();
      }
    } finally {
      // Auto-close when iteration completes
      if (!this.closed) {
        await this.close();
      }
    }
  }
}
