/**
 * Async Prepared Statement class
 *
 * @packageDocumentation
 */

import { DuckDBError } from '../errors.js';
import type { DuckDB } from './bindings.js';
import {
  WorkerRequestType,
  type PreparedStatementBinding,
  type QueryResultResponse,
  type RowsChangedResponse,
} from '../worker/protocol.js';

/**
 * A prepared SQL statement with parameter binding.
 *
 * Prepared statements are more secure (prevent SQL injection) and can be
 * more efficient when executing the same query multiple times with different parameters.
 *
 * Bind methods are synchronous (store locally), while run() and execute() are async
 * (send to worker).
 *
 * @category Query Results
 * @example
 * ```typescript
 * const stmt = await conn.prepare('SELECT * FROM users WHERE id = ? AND active = ?');
 * stmt.bindInt32(1, userId);
 * stmt.bindBoolean(2, true);
 * const result = await stmt.run();
 * await stmt.close();
 * ```
 */
export class PreparedStatement {
  private db: DuckDB;
  private connectionId: number;
  private preparedStatementId: number;
  private closed = false;
  private bindings: PreparedStatementBinding[] = [];

  /**
   * @internal
   */
  constructor(
    db: DuckDB,
    connectionId: number,
    preparedStatementId: number,
    _sql: string,
  ) {
    this.db = db;
    this.connectionId = connectionId;
    this.preparedStatementId = preparedStatementId;
    // sql kept for future debugging/logging purposes
  }

  private checkClosed(): void {
    if (this.closed) {
      throw new DuckDBError('Statement is closed');
    }
  }

  /**
   * Clear all parameter bindings.
   */
  clearBindings(): void {
    this.checkClosed();
    this.bindings = [];
  }

  // ============================================================================
  // Bind methods (synchronous - store locally)
  // ============================================================================

  /**
   * Bind a NULL value to a parameter.
   *
   * @param index - 1-based parameter index
   */
  bindNull(index: number): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'null', value: null });
  }

  /**
   * Bind a boolean value to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The boolean value
   */
  bindBoolean(index: number, value: boolean): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'boolean', value });
  }

  /**
   * Bind an 8-bit signed integer to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The integer value (-128 to 127)
   */
  bindInt8(index: number, value: number): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'int8', value });
  }

  /**
   * Bind a 16-bit signed integer to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The integer value (-32768 to 32767)
   */
  bindInt16(index: number, value: number): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'int16', value });
  }

  /**
   * Bind a 32-bit signed integer to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The integer value
   */
  bindInt32(index: number, value: number): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'int32', value });
  }

  /**
   * Bind a 64-bit signed integer to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The integer value (BigInt or number)
   */
  bindInt64(index: number, value: bigint | number): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'int64', value });
  }

  /**
   * Bind an 8-bit unsigned integer to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The integer value (0 to 255)
   */
  bindUInt8(index: number, value: number): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'uint8', value });
  }

  /**
   * Bind a 16-bit unsigned integer to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The integer value (0 to 65535)
   */
  bindUInt16(index: number, value: number): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'uint16', value });
  }

  /**
   * Bind a 32-bit unsigned integer to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The integer value
   */
  bindUInt32(index: number, value: number): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'uint32', value });
  }

  /**
   * Bind a 64-bit unsigned integer to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The integer value (BigInt or number)
   */
  bindUInt64(index: number, value: bigint | number): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'uint64', value });
  }

  /**
   * Bind a 32-bit float to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The float value
   */
  bindFloat(index: number, value: number): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'float', value });
  }

  /**
   * Bind a 64-bit double to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The double value
   */
  bindDouble(index: number, value: number): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'double', value });
  }

  /**
   * Bind a string value to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The string value
   */
  bindVarchar(index: number, value: string): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'varchar', value });
  }

  /**
   * Bind a blob (binary) value to a parameter.
   *
   * @param index - 1-based parameter index
   * @param value - The binary data
   */
  bindBlob(index: number, value: Uint8Array): void {
    this.checkClosed();
    this.bindings.push({ index, type: 'blob', value });
  }

  // ============================================================================
  // Execute methods (async - send to worker)
  // ============================================================================

  /**
   * Execute the prepared statement and return results.
   *
   * @returns Promise resolving to array of result rows as objects
   *
   * @example
   * ```typescript
   * const stmt = await conn.prepare('SELECT * FROM users WHERE id = ?');
   * stmt.bindInt32(1, 42);
   * const rows = await stmt.run();
   * ```
   */
  async run<T = Record<string, unknown>>(): Promise<T[]> {
    this.checkClosed();

    const response = await this.db.postTask<QueryResultResponse>(
      WorkerRequestType.RUN_PREPARED,
      {
        connectionId: this.connectionId,
        preparedStatementId: this.preparedStatementId,
        bindings: this.bindings,
      },
    );

    // Convert row arrays to objects
    const { columns, rows } = response;
    return rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i].name] = row[i];
      }
      return obj as T;
    });
  }

  /**
   * Execute the prepared statement and return the number of affected rows.
   *
   * Use this for INSERT, UPDATE, DELETE statements.
   *
   * @returns Promise resolving to the number of rows affected
   *
   * @example
   * ```typescript
   * const stmt = await conn.prepare('DELETE FROM users WHERE id = ?');
   * stmt.bindInt32(1, 42);
   * const deleted = await stmt.execute();
   * ```
   */
  async execute(): Promise<number> {
    this.checkClosed();

    const response = await this.db.postTask<RowsChangedResponse>(
      WorkerRequestType.EXECUTE_PREPARED,
      {
        connectionId: this.connectionId,
        preparedStatementId: this.preparedStatementId,
        bindings: this.bindings,
      },
    );

    return response.rowsChanged;
  }

  /**
   * Close the prepared statement and release resources.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    await this.db.postTask(WorkerRequestType.CLOSE_PREPARED, {
      connectionId: this.connectionId,
      preparedStatementId: this.preparedStatementId,
    });
    this.closed = true;
  }
}
