/**
 * Data Chunk class
 *
 * @packageDocumentation
 */

import type { ColumnInfo } from '../types.js';

/**
 * A chunk of data from a streaming query result.
 *
 * DataChunks contain a fixed number of rows and provide methods to
 * access the data in various formats.
 *
 * @category Query Results
 * @example
 * ```typescript
 * for await (const chunk of stream) {
 *   console.log(`Chunk has ${chunk.rowCount} rows`);
 *
 *   // Get as array of objects
 *   for (const row of chunk.toArray()) {
 *     console.log(row);
 *   }
 *
 *   // Or access raw columnar data
 *   const column = chunk.getColumn(0);
 *   console.log(column);
 * }
 * ```
 */
export class DataChunk {
  private columns: ColumnInfo[];
  private rows: unknown[][];
  private _rowCount: number;

  /**
   * @internal
   */
  constructor(columns: ColumnInfo[], rows: unknown[][], rowCount: number) {
    this.columns = columns;
    this.rows = rows;
    this._rowCount = rowCount;
  }

  /**
   * Get the number of rows in this chunk.
   */
  get rowCount(): number {
    return this._rowCount;
  }

  /**
   * Get the number of columns.
   */
  get columnCount(): number {
    return this.columns.length;
  }

  /**
   * Get the column information.
   */
  getColumns(): ColumnInfo[] {
    return this.columns;
  }

  /**
   * Get the raw row data.
   *
   * Each row is an array of values in column order.
   */
  getRows(): unknown[][] {
    return this.rows;
  }

  /**
   * Get a single column's values.
   *
   * @param index - The 0-based column index
   * @returns Array of values for that column
   */
  getColumn(index: number): unknown[] {
    if (index < 0 || index >= this.columns.length) {
      throw new Error(`Column index ${index} out of bounds`);
    }
    return this.rows.map((row) => row[index]);
  }

  /**
   * Get a single column's values by name.
   *
   * @param name - The column name
   * @returns Array of values for that column
   */
  getColumnByName(name: string): unknown[] {
    const index = this.columns.findIndex((col) => col.name === name);
    if (index === -1) {
      throw new Error(`Column "${name}" not found`);
    }
    return this.getColumn(index);
  }

  /**
   * Get a single row.
   *
   * @param index - The 0-based row index
   * @returns The row as an array of values
   */
  getRow(index: number): unknown[] {
    if (index < 0 || index >= this._rowCount) {
      throw new Error(`Row index ${index} out of bounds`);
    }
    return this.rows[index];
  }

  /**
   * Get a single row as an object.
   *
   * @param index - The 0-based row index
   * @returns The row as an object with column names as keys
   */
  getRowObject<T = Record<string, unknown>>(index: number): T {
    const row = this.getRow(index);
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < this.columns.length; i++) {
      obj[this.columns[i].name] = row[i];
    }
    return obj as T;
  }

  /**
   * Convert all rows to an array of objects.
   *
   * @returns Array of row objects with column names as keys
   */
  toArray<T = Record<string, unknown>>(): T[] {
    return this.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < this.columns.length; i++) {
        obj[this.columns[i].name] = row[i];
      }
      return obj as T;
    });
  }

  /**
   * Iterate over rows as objects.
   */
  *[Symbol.iterator](): Iterator<Record<string, unknown>> {
    for (let i = 0; i < this._rowCount; i++) {
      yield this.getRowObject(i);
    }
  }
}
