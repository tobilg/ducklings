/**
 * Error handling for Ducklings
 * @packageDocumentation
 */

/**
 * Error thrown by DuckDB operations.
 *
 * This error is thrown when DuckDB encounters an error during query execution,
 * connection management, or other database operations.
 *
 * @example
 * ```typescript
 * try {
 *   await conn.query('SELECT * FROM nonexistent_table');
 * } catch (e) {
 *   if (e instanceof DuckDBError) {
 *     console.error('DuckDB error:', e.message);
 *     console.error('Query:', e.query);
 *   }
 * }
 * ```
 */
export class DuckDBError extends Error {
  /** Error code if available */
  public readonly code?: string;
  /** The SQL query that caused the error */
  public readonly query?: string;

  constructor(message: string, code?: string, query?: string) {
    super(message);
    this.name = 'DuckDBError';
    this.code = code;
    this.query = query;
    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DuckDBError);
    }
  }

  /**
   * Create a DuckDBError from a plain object (for worker message deserialization).
   * @internal
   */
  static fromObject(obj: { message: string; code?: string; query?: string }): DuckDBError {
    return new DuckDBError(obj.message, obj.code, obj.query);
  }

  /**
   * Convert to a plain object for worker message serialization.
   * @internal
   */
  toObject(): { message: string; code?: string; query?: string } {
    return {
      message: this.message,
      code: this.code,
      query: this.query,
    };
  }
}
