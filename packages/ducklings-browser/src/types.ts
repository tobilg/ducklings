/**
 * Shared type definitions for Ducklings
 * @packageDocumentation
 */

/**
 * DuckDB type constants mapping to the C API type IDs.
 * @category Types
 */
export const DuckDBType = {
  INVALID: 0,
  BOOLEAN: 1,
  TINYINT: 2,
  SMALLINT: 3,
  INTEGER: 4,
  BIGINT: 5,
  UTINYINT: 6,
  USMALLINT: 7,
  UINTEGER: 8,
  UBIGINT: 9,
  FLOAT: 10,
  DOUBLE: 11,
  TIMESTAMP: 12,
  DATE: 13,
  TIME: 14,
  INTERVAL: 15,
  HUGEINT: 16,
  UHUGEINT: 32,
  VARCHAR: 17,
  BLOB: 18,
  DECIMAL: 19,
  TIMESTAMP_S: 20,
  TIMESTAMP_MS: 21,
  TIMESTAMP_NS: 22,
  ENUM: 23,
  LIST: 24,
  STRUCT: 25,
  MAP: 26,
  ARRAY: 33,
  UUID: 27,
  UNION: 28,
  BIT: 29,
  TIME_TZ: 30,
  TIMESTAMP_TZ: 31,
} as const;

/**
 * Type ID from DuckDB type constants.
 * @category Types
 */
export type DuckDBTypeId = (typeof DuckDBType)[keyof typeof DuckDBType];

/**
 * Column metadata for query results.
 * @category Types
 */
export interface ColumnInfo {
  /** Column name */
  name: string;
  /** DuckDB type ID */
  type: DuckDBTypeId;
  /** Type alias (e.g., "JSON" for aliased types) */
  alias?: string;
}

/**
 * Options for initializing the DuckDB WASM module.
 * @category Types
 */
export interface InitOptions {
  /**
   * URL to the WASM file (for browser environments).
   * If not provided, uses the default bundled WASM location.
   */
  wasmUrl?: string;

  /**
   * URL to the Emscripten JS file (duckdb.js).
   * Required for proper bundler support.
   */
  wasmJsUrl?: string;

  /**
   * URL to the worker script (for browser environments).
   * If not provided, uses the default bundled worker location.
   */
  workerUrl?: string;

  /**
   * Pre-compiled WebAssembly.Module (for Cloudflare Workers).
   * In Workers, import the WASM file directly and pass it here.
   */
  wasmModule?: WebAssembly.Module;

  /**
   * Whether to use the main thread instead of a Web Worker.
   * Defaults to false (use Web Worker).
   * Note: Main thread mode blocks the UI during operations.
   */
  useMainThread?: boolean;
}

/**
 * Emscripten module interface for DuckDB WASM.
 * @internal
 */
export interface EmscriptenModule {
  ccall: (
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
    opts?: { async?: boolean },
  ) => unknown | Promise<unknown>;
  cwrap: (
    name: string,
    returnType: string | null,
    argTypes: string[],
  ) => (...args: unknown[]) => unknown;
  getValue: (ptr: number, type: string) => number;
  setValue: (ptr: number, value: number, type: string) => void;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string, outPtr: number, maxBytesToWrite: number) => void;
  lengthBytesUTF8: (str: string) => number;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  stackAlloc: (size: number) => number;
  stackSave: () => number;
  stackRestore: (ptr: number) => void;
  HEAPU8: Uint8Array;
  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
}

/**
 * File information returned by globFiles.
 * @category Types
 */
export interface FileInfo {
  /** File name/path */
  name: string;
  /** File size in bytes */
  size: number;
}

/**
 * Options for CSV insertion.
 * @category Types
 */
export interface CSVInsertOptions {
  /** Whether the CSV has a header row */
  header?: boolean;
  /** Column delimiter */
  delimiter?: string;
  /** Quote character */
  quote?: string;
  /** Escape character */
  escape?: string;
  /** Skip rows at start */
  skip?: number;
  /** Column names (if no header) */
  columns?: string[];
}

/**
 * Options for JSON insertion.
 * @category Types
 */
export interface JSONInsertOptions {
  /** JSON format: 'auto', 'records', 'values', or 'newline_delimited' */
  format?: 'auto' | 'records' | 'values' | 'newline_delimited';
  /** Column names */
  columns?: string[];
}
