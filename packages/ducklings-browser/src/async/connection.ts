/**
 * Async Connection class
 *
 * @packageDocumentation
 */

import { tableFromIPC, type Table } from '@uwdata/flechette';
import type { CSVInsertOptions, JSONInsertOptions } from '../types.js';
import { DuckDBError } from '../errors.js';
import type { DuckDB } from './bindings.js';
import {
  WorkerRequestType,
  type QueryResultResponse,
  type ArrowIPCResponse,
  type StreamingResultInfoResponse,
  type RowsChangedResponse,
  type PreparedStatementIdResponse,
} from '../worker/protocol.js';
import { PreparedStatement } from './prepared-statement.js';
import { AsyncStreamingResult } from './streaming-result.js';

/**
 * A connection to a DuckDB database.
 *
 * Connections are used to execute queries and manage transactions.
 * All operations are async as they communicate with a Web Worker.
 *
 * @category Connection
 * @example
 * ```typescript
 * const conn = await db.connect();
 *
 * // Query returns array of objects
 * const rows = await conn.query('SELECT * FROM range(10)');
 *
 * // Query returns Arrow Table
 * const table = await conn.queryArrow('SELECT * FROM range(1000)');
 *
 * // Streaming for large results
 * const stream = await conn.queryStreaming('SELECT * FROM large_table');
 * for await (const chunk of stream) {
 *   console.log(chunk.rowCount);
 * }
 *
 * await conn.close();
 * ```
 */
export class Connection {
  private db: DuckDB;
  private connectionId: number;
  private closed = false;

  /**
   * @internal
   */
  constructor(db: DuckDB, connectionId: number) {
    this.db = db;
    this.connectionId = connectionId;
  }

  /**
   * Get the connection ID.
   * @internal
   */
  getConnectionId(): number {
    return this.connectionId;
  }

  /**
   * Get the database instance.
   * @internal
   */
  getDB(): DuckDB {
    return this.db;
  }

  private checkClosed(): void {
    if (this.closed) {
      throw new DuckDBError('Connection is closed');
    }
  }

  // ============================================================================
  // Query Operations
  // ============================================================================

  /**
   * Executes a SQL query and returns the results as an array of objects.
   *
   * @param sql - The SQL query to execute
   * @returns Promise resolving to array of result rows as objects
   *
   * @example
   * ```typescript
   * const rows = await conn.query<{ id: number; name: string }>(
   *   'SELECT * FROM users WHERE active = true'
   * );
   * for (const row of rows) {
   *   console.log(row.id, row.name);
   * }
   * ```
   */
  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    this.checkClosed();

    const response = await this.db.postTask<QueryResultResponse>(
      WorkerRequestType.QUERY,
      { connectionId: this.connectionId, sql },
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
   * Executes a SQL query and returns results as a Flechette Arrow Table.
   *
   * This method is more efficient for large result sets and provides
   * proper Arrow/columnar data representation.
   *
   * @param sql - The SQL query to execute
   * @returns Promise resolving to Arrow Table with query results
   *
   * @example
   * ```typescript
   * const table = await conn.queryArrow('SELECT * FROM range(1000000)');
   * console.log(table.numRows);
   * ```
   */
  async queryArrow(sql: string): Promise<Table> {
    this.checkClosed();

    const response = await this.db.postTask<ArrowIPCResponse>(
      WorkerRequestType.QUERY_ARROW,
      { connectionId: this.connectionId, sql },
    );

    return tableFromIPC(response.ipcBuffer);
  }

  /**
   * Executes a SQL query and returns a streaming result.
   *
   * This method is more memory-efficient for large result sets as it
   * processes data in chunks rather than loading everything at once.
   *
   * @param sql - The SQL query to execute
   * @returns Promise resolving to AsyncStreamingResult that can be iterated over
   *
   * @example
   * ```typescript
   * const stream = await conn.queryStreaming('SELECT * FROM large_table');
   * for await (const chunk of stream) {
   *   console.log(`Processing ${chunk.rowCount} rows`);
   *   for (const row of chunk.toArray()) {
   *     processRow(row);
   *   }
   * }
   * await stream.close();
   * ```
   */
  async queryStreaming(sql: string): Promise<AsyncStreamingResult> {
    this.checkClosed();

    const response = await this.db.postTask<StreamingResultInfoResponse>(
      WorkerRequestType.QUERY_STREAMING,
      { connectionId: this.connectionId, sql },
    );

    return new AsyncStreamingResult(
      this.db,
      this.connectionId,
      response.streamingResultId,
      response.columns,
    );
  }

  /**
   * Executes a SQL statement and returns the number of affected rows.
   *
   * Use this for INSERT, UPDATE, DELETE, or other statements where you
   * don't need to read result rows.
   *
   * @param sql - The SQL statement to execute
   * @returns Promise resolving to the number of rows affected
   *
   * @example
   * ```typescript
   * const deleted = await conn.execute('DELETE FROM users WHERE inactive = true');
   * console.log(`Deleted ${deleted} users`);
   * ```
   */
  async execute(sql: string): Promise<number> {
    this.checkClosed();

    const response = await this.db.postTask<RowsChangedResponse>(
      WorkerRequestType.EXECUTE,
      { connectionId: this.connectionId, sql },
    );

    return response.rowsChanged;
  }

  // ============================================================================
  // Prepared Statements
  // ============================================================================

  /**
   * Prepares a SQL statement for execution.
   *
   * Prepared statements are more secure (prevent SQL injection) and can be
   * more efficient when executing the same query multiple times with different parameters.
   *
   * @param sql - The SQL statement with parameter placeholders (?)
   * @returns Promise resolving to a PreparedStatement instance
   *
   * @example
   * ```typescript
   * const stmt = await conn.prepare('SELECT * FROM users WHERE id = ?');
   * stmt.bindInt32(1, 42);
   * const rows = await stmt.run();
   * await stmt.close();
   * ```
   */
  async prepare(sql: string): Promise<PreparedStatement> {
    this.checkClosed();

    const response = await this.db.postTask<PreparedStatementIdResponse>(
      WorkerRequestType.PREPARE,
      { connectionId: this.connectionId, sql },
    );

    return new PreparedStatement(
      this.db,
      this.connectionId,
      response.preparedStatementId,
      sql,
    );
  }

  // ============================================================================
  // Transactions
  // ============================================================================

  /**
   * Begins a new transaction.
   *
   * @example
   * ```typescript
   * await conn.beginTransaction();
   * try {
   *   await conn.execute('INSERT INTO users (name) VALUES ($1)', ['Alice']);
   *   await conn.execute('UPDATE balances SET amount = amount - 100 WHERE user = $1', ['Alice']);
   *   await conn.commit();
   * } catch (e) {
   *   await conn.rollback();
   *   throw e;
   * }
   * ```
   */
  async beginTransaction(): Promise<void> {
    this.checkClosed();
    await this.db.postTask(WorkerRequestType.BEGIN_TRANSACTION, {
      connectionId: this.connectionId,
    });
  }

  /**
   * Commits the current transaction.
   */
  async commit(): Promise<void> {
    this.checkClosed();
    await this.db.postTask(WorkerRequestType.COMMIT, {
      connectionId: this.connectionId,
    });
  }

  /**
   * Rolls back the current transaction.
   */
  async rollback(): Promise<void> {
    this.checkClosed();
    await this.db.postTask(WorkerRequestType.ROLLBACK, {
      connectionId: this.connectionId,
    });
  }

  /**
   * Execute a function within a transaction.
   *
   * The transaction is automatically committed on success or rolled back on error.
   *
   * @param fn - The function to execute within the transaction
   * @returns Promise resolving to the function's return value
   *
   * @example
   * ```typescript
   * const result = await conn.transaction(async () => {
   *   await conn.execute('INSERT INTO users (name) VALUES ($1)', ['Alice']);
   *   return await conn.query('SELECT * FROM users WHERE name = $1', ['Alice']);
   * });
   * ```
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.beginTransaction();
    try {
      const result = await fn();
      await this.commit();
      return result;
    } catch (e) {
      await this.rollback();
      throw e;
    }
  }

  // ============================================================================
  // Data Insertion
  // ============================================================================

  /**
   * Insert data from an Arrow IPC buffer.
   *
   * @param tableName - The name of the table to insert into
   * @param ipcBuffer - The Arrow IPC buffer containing the data
   *
   * @example
   * ```typescript
   * import { tableToIPC } from '@uwdata/flechette';
   * const ipcBuffer = tableToIPC(myArrowTable);
   * await conn.insertArrowFromIPCStream('my_table', ipcBuffer);
   * ```
   */
  async insertArrowFromIPCStream(tableName: string, ipcBuffer: Uint8Array): Promise<void> {
    this.checkClosed();

    await this.db.postTask(
      WorkerRequestType.INSERT_ARROW_FROM_IPC,
      { connectionId: this.connectionId, tableName, ipcBuffer },
      [ipcBuffer.buffer],
    );
  }

  /**
   * Insert data from a CSV file.
   *
   * @param tableName - The name of the table to insert into
   * @param path - The virtual file path of the CSV
   * @param options - Optional CSV parsing options
   *
   * @example
   * ```typescript
   * await db.registerFileBuffer('data.csv', csvData);
   * await conn.insertCSVFromPath('my_table', 'data.csv', { header: true });
   * ```
   */
  async insertCSVFromPath(
    tableName: string,
    path: string,
    options?: CSVInsertOptions,
  ): Promise<void> {
    this.checkClosed();

    await this.db.postTask(WorkerRequestType.INSERT_CSV_FROM_PATH, {
      connectionId: this.connectionId,
      tableName,
      path,
      options,
    });
  }

  /**
   * Insert data from a JSON file.
   *
   * @param tableName - The name of the table to insert into
   * @param path - The virtual file path of the JSON
   * @param options - Optional JSON parsing options
   *
   * @example
   * ```typescript
   * await db.registerFileBuffer('data.json', jsonData);
   * await conn.insertJSONFromPath('my_table', 'data.json');
   * ```
   */
  async insertJSONFromPath(
    tableName: string,
    path: string,
    options?: JSONInsertOptions,
  ): Promise<void> {
    this.checkClosed();

    await this.db.postTask(WorkerRequestType.INSERT_JSON_FROM_PATH, {
      connectionId: this.connectionId,
      tableName,
      path,
      options,
    });
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Closes the connection and releases resources.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    await this.db.postTask(WorkerRequestType.DISCONNECT, {
      connectionId: this.connectionId,
    });
    this.closed = true;
  }
}
