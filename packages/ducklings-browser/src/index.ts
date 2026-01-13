/**
 * Ducklings - Minimal DuckDB for browser environments
 *
 * This package provides a lightweight DuckDB binding for WebAssembly,
 * using Web Workers for async operations. All DuckDB operations run
 * in a background worker thread to keep the main thread responsive.
 *
 * @packageDocumentation
 *
 * @example Basic usage
 * ```typescript
 * import { init, DuckDB } from '@ducklings/browser';
 *
 * // Initialize (creates worker internally)
 * await init();
 *
 * // Create database and connection
 * const db = new DuckDB();
 * const conn = await db.connect();
 *
 * // Execute queries
 * const rows = await conn.query('SELECT * FROM range(10)');
 * console.log(rows);
 *
 * // Get results as Arrow Table
 * const table = await conn.queryArrow('SELECT * FROM range(1000)');
 *
 * // Clean up
 * await conn.close();
 * await db.close();
 * ```
 *
 * @example File registration
 * ```typescript
 * // Register remote file
 * await db.registerFileURL('remote.parquet', 'https://example.com/data.parquet');
 * const data = await conn.query("SELECT * FROM 'remote.parquet' LIMIT 10");
 *
 * // Register in-memory data
 * const csvData = new TextEncoder().encode('id,name\n1,Alice\n2,Bob');
 * await db.registerFileBuffer('data.csv', csvData);
 * await conn.query("CREATE TABLE users AS SELECT * FROM read_csv('/data.csv')");
 * ```
 *
 * @example Streaming large results
 * ```typescript
 * const stream = await conn.queryStreaming('SELECT * FROM large_table');
 * for await (const chunk of stream) {
 *   console.log(`Processing ${chunk.rowCount} rows`);
 * }
 * ```
 *
 * @example Prepared statements
 * ```typescript
 * const stmt = await conn.prepare('SELECT * FROM users WHERE id = ?');
 * stmt.bindInt32(1, 42);
 * const result = await stmt.run();
 * await stmt.close();
 * ```
 */

// Re-export flechette types for convenience
export type { Table } from '@uwdata/flechette';
// Main API
export { DuckDB, getDB, init, version } from './async/bindings.js';
export { Connection } from './async/connection.js';
export { DataChunk } from './async/data-chunk.js';
export { PreparedStatement } from './async/prepared-statement.js';
export { AsyncStreamingResult as StreamingResult } from './async/streaming-result.js';
// Errors
export { DuckDBError } from './errors.js';
// Types
export {
  AccessMode,
  type ColumnInfo,
  type CSVInsertOptions,
  type DuckDBConfig,
  DuckDBType,
  type DuckDBTypeId,
  type FileInfo,
  type InitOptions,
  type JSONInsertOptions,
} from './types.js';
