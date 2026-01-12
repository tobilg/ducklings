/**
 * Ducklings Workers - Minimal DuckDB for Cloudflare Workers
 *
 * This package provides a lightweight DuckDB binding for WebAssembly,
 * designed for Cloudflare Workers and serverless environments.
 *
 * IMPORTANT: In this build, query() and execute() are async and return Promises.
 * Always use: `await conn.query(...)` or `await conn.execute(...)`
 *
 * @packageDocumentation
 */

import {
  bool,
  type DataType,
  dateDay,
  float32,
  float64,
  int8,
  int16,
  int32,
  int64,
  type Table,
  TimeUnit,
  tableFromArrays,
  timestamp,
  uint8,
  uint16,
  uint32,
  uint64,
  utf8,
} from '@uwdata/flechette';

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
 * Database access mode.
 * @category Configuration
 */
export enum AccessMode {
  /** DuckDB determines mode based on context (resolves to READ_WRITE for in-memory) */
  AUTOMATIC = 'automatic',
  /** Read-only mode - all write operations are blocked */
  READ_ONLY = 'read_only',
  /** Read-write mode - allows both reads and writes */
  READ_WRITE = 'read_write',
}

/**
 * DuckDB configuration options.
 * @category Configuration
 */
export interface DuckDBConfig {
  /**
   * Database access mode.
   * Use READ_ONLY to prevent any data modification.
   * @default AccessMode.AUTOMATIC
   */
  accessMode?: AccessMode;

  /**
   * Enable external access (file I/O, httpfs, etc.).
   * Set to false to prevent all external data access.
   * WARNING: Setting to false will disable httpfs functionality.
   * @default true
   */
  enableExternalAccess?: boolean;

  /**
   * Lock configuration after startup.
   * Prevents runtime configuration changes via SQL SET commands.
   * @default true (secure default)
   */
  lockConfiguration?: boolean;

  /**
   * Custom configuration options.
   * Key-value pairs passed directly to duckdb_set_config.
   * @see https://duckdb.org/docs/configuration/overview
   */
  customConfig?: Record<string, string>;
}

/**
 * Error thrown by DuckDB operations.
 * @category Types
 */
export class DuckDBError extends Error {
  public readonly code?: string;
  public readonly query?: string;

  constructor(message: string, code?: string, query?: string) {
    super(message);
    this.name = 'DuckDBError';
    this.code = code;
    this.query = query;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DuckDBError);
    }
  }
}

/**
 * Options for SQL sanitization.
 * @category Security
 */
export interface SanitizeSqlOptions {
  /** Allow PRAGMA statements (default: false) */
  allowPragma?: boolean;
  /** Allow COPY ... TO statements (default: false) */
  allowCopyTo?: boolean;
  /** Allow EXPORT DATABASE statements (default: false) */
  allowExportDatabase?: boolean;
  /** Allow duckdb_secrets() function (default: false) */
  allowSecretsFunction?: boolean;
}

/**
 * Result of SQL sanitization check.
 * @category Security
 */
export interface SanitizeResult {
  /** Whether the SQL is considered safe */
  safe: boolean;
  /** The original SQL string */
  sql: string;
  /** Reason why the SQL was blocked (if unsafe) */
  reason?: string;
  /** The pattern that matched (if unsafe) */
  matchedPattern?: string;
}

/**
 * Strips SQL comments to prevent bypass attempts.
 * @internal
 */
function stripSqlComments(sql: string): string {
  // Remove /* ... */ block comments (non-greedy)
  let result = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Remove -- line comments
  result = result.replace(/--[^\n\r]*/g, ' ');
  // Remove # line comments (MySQL-style, supported by DuckDB)
  result = result.replace(/#[^\n\r]*/g, ' ');
  return result;
}

/**
 * Dangerous SQL patterns to block.
 * @internal
 */
const DANGEROUS_PATTERNS = {
  secretsFunction: {
    pattern: /\bduckdb_secrets\s*\(/i,
    message: 'Access to duckdb_secrets() is not allowed',
  },
  pragma: {
    pattern: /^\s*PRAGMA\b/im,
    message: 'PRAGMA statements are not allowed',
  },
  copyTo: {
    pattern: /\bCOPY\b[\s\S]+?\bTO\b\s+['"`]/i,
    message: 'COPY ... TO statements are not allowed',
  },
  exportDatabase: {
    pattern: /\bEXPORT\s+DATABASE\b/i,
    message: 'EXPORT DATABASE statements are not allowed',
  },
} as const;

/**
 * Checks if a SQL statement contains dangerous patterns.
 *
 * This function does not throw - it returns a result object indicating
 * whether the SQL is safe or not. Use this when you want to handle
 * unsafe SQL yourself.
 *
 * @category Security
 * @param sql - The SQL statement to check
 * @param options - Options to selectively allow certain patterns
 * @returns A SanitizeResult object with safety status
 *
 * @example
 * ```typescript
 * const result = checkSql("SELECT * FROM duckdb_secrets()");
 * if (!result.safe) {
 *   console.log(`Blocked: ${result.reason}`);
 * }
 * ```
 */
export function checkSql(sql: string, options: SanitizeSqlOptions = {}): SanitizeResult {
  // Strip comments before checking patterns
  const strippedSql = stripSqlComments(sql);

  // Check each pattern unless explicitly allowed
  if (!options.allowSecretsFunction && DANGEROUS_PATTERNS.secretsFunction.pattern.test(strippedSql)) {
    return {
      safe: false,
      sql,
      reason: DANGEROUS_PATTERNS.secretsFunction.message,
      matchedPattern: 'duckdb_secrets()',
    };
  }

  if (!options.allowPragma && DANGEROUS_PATTERNS.pragma.pattern.test(strippedSql)) {
    return {
      safe: false,
      sql,
      reason: DANGEROUS_PATTERNS.pragma.message,
      matchedPattern: 'PRAGMA',
    };
  }

  if (!options.allowCopyTo && DANGEROUS_PATTERNS.copyTo.pattern.test(strippedSql)) {
    return {
      safe: false,
      sql,
      reason: DANGEROUS_PATTERNS.copyTo.message,
      matchedPattern: 'COPY ... TO',
    };
  }

  if (!options.allowExportDatabase && DANGEROUS_PATTERNS.exportDatabase.pattern.test(strippedSql)) {
    return {
      safe: false,
      sql,
      reason: DANGEROUS_PATTERNS.exportDatabase.message,
      matchedPattern: 'EXPORT DATABASE',
    };
  }

  return { safe: true, sql };
}

/**
 * Sanitizes a SQL statement by checking for dangerous patterns.
 *
 * This function throws a DuckDBError if the SQL contains dangerous patterns.
 * Use this in request handlers to automatically reject unsafe queries.
 *
 * **Blocked patterns:**
 * - `duckdb_secrets()` - Exposes database credentials
 * - `PRAGMA` - Can modify database settings
 * - `COPY ... TO` - Writes files to disk (COPY FROM is allowed)
 * - `EXPORT DATABASE` - Exports database to files
 *
 * Note: SET commands are blocked separately by `lockConfiguration: true` in DuckDBConfig.
 *
 * @category Security
 * @param sql - The SQL statement to sanitize
 * @param options - Options to selectively allow certain patterns
 * @returns The original SQL if safe
 * @throws DuckDBError with code 'SANITIZE_ERROR' if dangerous patterns detected
 *
 * @example
 * ```typescript
 * import { sanitizeSql, DuckDBError } from '@ducklings/workers';
 *
 * // In a request handler
 * try {
 *   const safeSql = sanitizeSql(userInput);
 *   const result = await conn.query(safeSql);
 *   return Response.json({ data: result });
 * } catch (e) {
 *   if (e instanceof DuckDBError && e.code === 'SANITIZE_ERROR') {
 *     return Response.json({ error: e.message }, { status: 400 });
 *   }
 *   throw e;
 * }
 * ```
 */
export function sanitizeSql(sql: string, options: SanitizeSqlOptions = {}): string {
  const result = checkSql(sql, options);

  if (!result.safe) {
    throw new DuckDBError(result.reason!, 'SANITIZE_ERROR', sql);
  }

  return sql;
}

/**
 * Column metadata for query results.
 * @category Types
 */
export interface ColumnInfo {
  name: string;
  type: DuckDBTypeId;
  alias?: string;
}

// Emscripten module interface
interface EmscriptenModule {
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

// Module state
let module: EmscriptenModule | null = null;
let initPromise: Promise<EmscriptenModule> | null = null;

/**
 * Helper to get the current module, throwing if not initialized.
 */
function getModule(): EmscriptenModule {
  if (!module) {
    throw new DuckDBError('DuckDB WASM not initialized. Call init() first.');
  }
  return module;
}

/**
 * Options for initializing the DuckDB WASM module (workers build).
 * @category Types
 */
export interface InitOptions {
  /**
   * Pre-compiled WebAssembly.Module (required for Cloudflare Workers)
   * In Workers, import the WASM file directly and pass it here.
   *
   * @example
   * ```typescript
   * import wasmModule from '@ducklings/workers/wasm';
   * await init({ wasmModule });
   * ```
   */
  wasmModule: WebAssembly.Module;
}

/**
 * Initialize the DuckDB WASM module (workers build with Asyncify).
 *
 * This version is optimized for Cloudflare Workers and uses the workers-specific
 * WASM build that includes Asyncify support for async HTTP operations.
 *
 * @category Database
 * @param options - Initialization options with pre-compiled WASM module
 * @returns Promise that resolves when initialization is complete
 *
 * @example
 * ```typescript
 * import { init, DuckDB } from '@ducklings/workers';
 * import wasmModule from '@ducklings/workers/wasm';
 *
 * await init({ wasmModule });
 *
 * const db = new DuckDB();
 * const conn = db.connect();
 *
 * // httpfs works in CF Workers with this build!
 * const result = await conn.query("SELECT * FROM 'https://example.com/data.parquet'");
 * ```
 */
export async function init(options: InitOptions): Promise<void> {
  if (module) {
    return;
  }

  if (initPromise) {
    await initPromise;
    return;
  }

  if (!options?.wasmModule) {
    throw new Error(
      'Workers build requires a pre-compiled WASM module. ' +
        'Import the WASM file and pass it as { wasmModule }.',
    );
  }

  initPromise = (async () => {
    // Dynamic import of the workers-specific Emscripten-generated JavaScript
    const DuckDBModule = (await import('./wasm/duckdb-workers.js')).default;

    // Initialize the Emscripten module with pre-compiled WASM
    const config: Record<string, unknown> = {
      instantiateWasm: (
        imports: WebAssembly.Imports,
        receiveInstance: (instance: WebAssembly.Instance) => void,
      ) => {
        WebAssembly.instantiate(options.wasmModule, imports).then((instance) => {
          receiveInstance(instance);
        });
        return {}; // Return empty exports, will be filled by receiveInstance
      },
    };

    const mod = await DuckDBModule(config);
    return mod as EmscriptenModule;
  })();

  module = await initPromise;
}

/**
 * Returns the DuckDB library version.
 * @category Database
 */
export function version(): string {
  if (!module) {
    throw new DuckDBError('DuckDB WASM not initialized. Call init() first.');
  }
  const versionPtr = module.ccall('duckdb_library_version', 'number', [], []) as number;
  return module.UTF8ToString(versionPtr);
}

/**
 * Reads column data from DuckDB result with proper type conversion.
 * @internal
 */
function readColumnData(
  mod: EmscriptenModule,
  dataPtr: number,
  nullmaskPtr: number,
  rowCount: number,
  duckdbType: number,
): unknown[] {
  const result: unknown[] = new Array(rowCount);
  const hasNullmask = nullmaskPtr !== 0;

  switch (duckdbType) {
    case DuckDBType.BOOLEAN: {
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          result[i] = mod.HEAPU8[dataPtr + i] !== 0;
        }
      }
      break;
    }

    case DuckDBType.TINYINT: {
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          result[i] = mod.HEAP8[dataPtr + i];
        }
      }
      break;
    }

    case DuckDBType.SMALLINT: {
      const offset = dataPtr >> 1;
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          result[i] = mod.HEAP16[offset + i];
        }
      }
      break;
    }

    case DuckDBType.INTEGER: {
      const offset = dataPtr >> 2;
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          result[i] = mod.HEAP32[offset + i];
        }
      }
      break;
    }

    case DuckDBType.BIGINT: {
      const offset = dataPtr >> 2;
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          const low = mod.HEAPU32[offset + i * 2];
          const high = mod.HEAP32[offset + i * 2 + 1];
          // Check if value fits in safe integer range before computing
          // Safe range: high is 0 (positive small) or -1 (negative small)
          if (high === 0 && low <= 0x1fffffffffffff) {
            result[i] = low;
          } else if (high === -1 && low >= 0x80000000) {
            // Small negative number
            result[i] = high * 0x100000000 + low;
          } else {
            // Large value - return as string for JSON compatibility
            // Compute using BigInt for precision, then convert to string
            const bigValue = BigInt(high) * BigInt(0x100000000) + BigInt(low >>> 0);
            result[i] = bigValue.toString();
          }
        }
      }
      break;
    }

    case DuckDBType.UTINYINT: {
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          result[i] = mod.HEAPU8[dataPtr + i];
        }
      }
      break;
    }

    case DuckDBType.USMALLINT: {
      const offset = dataPtr >> 1;
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          result[i] = mod.HEAPU16[offset + i];
        }
      }
      break;
    }

    case DuckDBType.UINTEGER: {
      const offset = dataPtr >> 2;
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          result[i] = mod.HEAPU32[offset + i];
        }
      }
      break;
    }

    case DuckDBType.UBIGINT: {
      const offset = dataPtr >> 2;
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          const low = mod.HEAPU32[offset + i * 2];
          const high = mod.HEAPU32[offset + i * 2 + 1];
          // Check if value fits in safe integer range before computing
          if (high === 0 && low <= 0x1fffffffffffff) {
            result[i] = low;
          } else {
            // Large value - return as string for JSON compatibility
            const bigValue = BigInt(high) * BigInt(0x100000000) + BigInt(low);
            result[i] = bigValue.toString();
          }
        }
      }
      break;
    }

    case DuckDBType.FLOAT: {
      const offset = dataPtr >> 2;
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          result[i] = mod.HEAPF32[offset + i];
        }
      }
      break;
    }

    case DuckDBType.DOUBLE: {
      const offset = dataPtr >> 3;
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          result[i] = mod.HEAPF64[offset + i];
        }
      }
      break;
    }

    case DuckDBType.DATE: {
      const offset = dataPtr >> 2;
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          const days = mod.HEAP32[offset + i];
          const date = new Date(days * 24 * 60 * 60 * 1000);
          result[i] = date.toISOString().split('T')[0];
        }
      }
      break;
    }

    case DuckDBType.TIMESTAMP:
    case DuckDBType.TIMESTAMP_TZ: {
      const offset = dataPtr >> 2;
      for (let i = 0; i < rowCount; i++) {
        if (hasNullmask && mod.HEAPU8[nullmaskPtr + i]) {
          result[i] = null;
        } else {
          // Timestamp is stored as microseconds since epoch
          const low = mod.HEAPU32[offset + i * 2];
          const high = mod.HEAP32[offset + i * 2 + 1];
          const micros = BigInt(high) * BigInt(0x100000000) + BigInt(low >>> 0);
          const millis = Number(micros / BigInt(1000));
          const date = new Date(millis);
          result[i] = date.toISOString();
        }
      }
      break;
    }

    default:
      // Return null for unsupported types - will be handled by varchar fallback
      for (let i = 0; i < rowCount; i++) {
        result[i] = null;
      }
      break;
  }

  return result;
}

/**
 * A prepared SQL statement with parameter binding.
 * @category Query Results
 */
export class PreparedStatement {
  private stmtPtr: number;
  private closed = false;
  private readonly sql: string;

  /** @internal */
  constructor(stmtPtr: number, _connPtr: number, sql: string) {
    this.stmtPtr = stmtPtr;
    this.sql = sql;
  }

  parameterCount(): number {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();
    return mod.ccall('duckdb_nparams', 'number', ['number'], [this.stmtPtr]) as number;
  }

  bindBoolean(index: number, value: boolean): this {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();
    const result = mod.ccall(
      'duckdb_bind_boolean',
      'number',
      ['number', 'number', 'number', 'number'],
      [this.stmtPtr, index, 0, value ? 1 : 0],
    ) as number;
    if (result !== 0) throw new DuckDBError(`Failed to bind boolean at index ${index}`);
    return this;
  }

  bindInt32(index: number, value: number): this {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();
    const result = mod.ccall(
      'duckdb_bind_int32',
      'number',
      ['number', 'number', 'number', 'number'],
      [this.stmtPtr, index, 0, value],
    ) as number;
    if (result !== 0) throw new DuckDBError(`Failed to bind int32 at index ${index}`);
    return this;
  }

  bindInt64(index: number, value: bigint | number): this {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();
    const val = BigInt(value);
    const valLow = Number(val & BigInt(0xffffffff));
    const valHigh = Number((val >> BigInt(32)) & BigInt(0xffffffff));
    const result = mod.ccall(
      'duckdb_bind_int64',
      'number',
      ['number', 'number', 'number', 'number', 'number'],
      [this.stmtPtr, index, 0, valLow, valHigh],
    ) as number;
    if (result !== 0) throw new DuckDBError(`Failed to bind int64 at index ${index}`);
    return this;
  }

  bindFloat(index: number, value: number): this {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();
    const result = mod.ccall(
      'duckdb_bind_float',
      'number',
      ['number', 'number', 'number', 'number'],
      [this.stmtPtr, index, 0, value],
    ) as number;
    if (result !== 0) throw new DuckDBError(`Failed to bind float at index ${index}`);
    return this;
  }

  bindDouble(index: number, value: number): this {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();
    const result = mod.ccall(
      'duckdb_bind_double',
      'number',
      ['number', 'number', 'number', 'number'],
      [this.stmtPtr, index, 0, value],
    ) as number;
    if (result !== 0) throw new DuckDBError(`Failed to bind double at index ${index}`);
    return this;
  }

  bindString(index: number, value: string): this {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();
    const result = mod.ccall(
      'duckdb_bind_varchar',
      'number',
      ['number', 'number', 'number', 'string'],
      [this.stmtPtr, index, 0, value],
    ) as number;
    if (result !== 0) throw new DuckDBError(`Failed to bind string at index ${index}`);
    return this;
  }

  bindBlob(index: number, value: Uint8Array): this {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();
    const ptr = mod._malloc(value.length);
    try {
      mod.HEAPU8.set(value, ptr);
      const result = mod.ccall(
        'duckdb_bind_blob',
        'number',
        ['number', 'number', 'number', 'number', 'number', 'number'],
        [this.stmtPtr, index, 0, ptr, value.length, 0],
      ) as number;
      if (result !== 0) throw new DuckDBError(`Failed to bind blob at index ${index}`);
    } finally {
      mod._free(ptr);
    }
    return this;
  }

  bindNull(index: number): this {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();
    const result = mod.ccall(
      'duckdb_bind_null',
      'number',
      ['number', 'number', 'number'],
      [this.stmtPtr, index, 0],
    ) as number;
    if (result !== 0) throw new DuckDBError(`Failed to bind null at index ${index}`);
    return this;
  }

  bindTimestamp(index: number, value: Date): this {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();
    const micros = BigInt(value.getTime()) * BigInt(1000);
    const tsLow = Number(micros & BigInt(0xffffffff));
    const tsHigh = Number((micros >> BigInt(32)) & BigInt(0xffffffff));
    const result = mod.ccall(
      'duckdb_bind_timestamp',
      'number',
      ['number', 'number', 'number', 'number', 'number'],
      [this.stmtPtr, index, 0, tsLow, tsHigh],
    ) as number;
    if (result !== 0) throw new DuckDBError(`Failed to bind timestamp at index ${index}`);
    return this;
  }

  bindDate(index: number, value: Date): this {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();
    const days = Math.floor(value.getTime() / (24 * 60 * 60 * 1000));
    const result = mod.ccall(
      'duckdb_bind_date',
      'number',
      ['number', 'number', 'number', 'number'],
      [this.stmtPtr, index, 0, days],
    ) as number;
    if (result !== 0) throw new DuckDBError(`Failed to bind date at index ${index}`);
    return this;
  }

  bind(index: number, value: unknown): this {
    if (value === null || value === undefined) return this.bindNull(index);
    if (typeof value === 'boolean') return this.bindBoolean(index, value);
    if (typeof value === 'number') {
      if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) {
        return this.bindInt32(index, value);
      }
      return this.bindDouble(index, value);
    }
    if (typeof value === 'bigint') return this.bindInt64(index, value);
    if (typeof value === 'string') return this.bindString(index, value);
    if (value instanceof Date) return this.bindTimestamp(index, value);
    if (value instanceof Uint8Array) return this.bindBlob(index, value);
    return this.bindString(index, String(value));
  }

  /**
   * Executes the prepared statement and returns results as an array of objects.
   * @returns Promise resolving to array of result rows
   */
  async run<T = Record<string, unknown>>(): Promise<T[]> {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();

    const resultPtr = mod._malloc(64);
    try {
      const status = (await mod.ccall(
        'duckdb_execute_prepared',
        'number',
        ['number', 'number'],
        [this.stmtPtr, resultPtr],
        { async: true },
      )) as number;

      if (status !== 0) {
        const errorPtr = mod.ccall(
          'duckdb_result_error',
          'number',
          ['number'],
          [resultPtr],
        ) as number;
        const errorMsg = errorPtr
          ? mod.UTF8ToString(errorPtr)
          : 'Prepared statement execution failed';
        mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new DuckDBError(errorMsg, undefined, this.sql);
      }

      const columnCount = mod.ccall(
        'duckdb_column_count',
        'number',
        ['number'],
        [resultPtr],
      ) as number;
      const rowCount = mod.ccall('duckdb_row_count', 'number', ['number'], [resultPtr]) as number;

      // Get column metadata (name and type)
      const columns: { name: string; type: number }[] = [];
      for (let i = 0; i < columnCount; i++) {
        const namePtr = mod.ccall(
          'duckdb_column_name',
          'number',
          ['number', 'number'],
          [resultPtr, i],
        ) as number;

        const type = mod.ccall(
          'duckdb_column_type',
          'number',
          ['number', 'number'],
          [resultPtr, i],
        ) as number;

        columns.push({
          name: mod.UTF8ToString(namePtr),
          type,
        });
      }

      // Extract column data with proper types
      const columnData: unknown[][] = [];
      for (let colIdx = 0; colIdx < columnCount; colIdx++) {
        const col = columns[colIdx];

        const dataPtr = mod.ccall(
          'duckdb_column_data',
          'number',
          ['number', 'number'],
          [resultPtr, colIdx],
        ) as number;

        const nullmaskPtr = mod.ccall(
          'duckdb_nullmask_data',
          'number',
          ['number', 'number'],
          [resultPtr, colIdx],
        ) as number;

        if (col.type === DuckDBType.VARCHAR || dataPtr === 0) {
          // VARCHAR or unsupported type - use value_varchar
          const values: unknown[] = new Array(rowCount);
          for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
            const isNull = mod.ccall(
              'duckdb_value_is_null',
              'number',
              ['number', 'number', 'number', 'number', 'number'],
              [resultPtr, colIdx, 0, rowIdx, 0],
            ) as number;

            if (isNull) {
              values[rowIdx] = null;
            } else {
              const strPtr = mod.ccall(
                'duckdb_value_varchar',
                'number',
                ['number', 'number', 'number', 'number', 'number'],
                [resultPtr, colIdx, 0, rowIdx, 0],
              ) as number;
              if (strPtr) {
                values[rowIdx] = mod.UTF8ToString(strPtr);
                mod._free(strPtr);
              } else {
                values[rowIdx] = null;
              }
            }
          }
          columnData.push(values);
        } else {
          // Use type-specific extraction
          columnData.push(readColumnData(mod, dataPtr, nullmaskPtr, rowCount, col.type));
        }
      }

      // Build result rows
      const rows: T[] = new Array(rowCount);
      for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
        const row: Record<string, unknown> = {};
        for (let colIdx = 0; colIdx < columnCount; colIdx++) {
          row[columns[colIdx].name] = columnData[colIdx][rowIdx];
        }
        rows[rowIdx] = row as T;
      }

      mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
      return rows;
    } finally {
      mod._free(resultPtr);
    }
  }

  /**
   * Executes the prepared statement without returning results.
   * @returns Promise resolving to number of rows affected
   */
  async execute(): Promise<number> {
    if (this.closed) throw new DuckDBError('Statement is closed');
    const mod = getModule();

    const resultPtr = mod._malloc(64);
    try {
      const status = (await mod.ccall(
        'duckdb_execute_prepared',
        'number',
        ['number', 'number'],
        [this.stmtPtr, resultPtr],
        { async: true },
      )) as number;

      if (status !== 0) {
        const errorPtr = mod.ccall(
          'duckdb_result_error',
          'number',
          ['number'],
          [resultPtr],
        ) as number;
        const errorMsg = errorPtr
          ? mod.UTF8ToString(errorPtr)
          : 'Prepared statement execution failed';
        mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new DuckDBError(errorMsg, undefined, this.sql);
      }

      const rowsChanged = mod.ccall(
        'duckdb_rows_changed',
        'number',
        ['number'],
        [resultPtr],
      ) as number;
      mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
      return rowsChanged;
    } finally {
      mod._free(resultPtr);
    }
  }

  close(): void {
    if (this.closed) return;
    const mod = getModule();
    const stmtPtrPtr = mod._malloc(4);
    try {
      mod.setValue(stmtPtrPtr, this.stmtPtr, 'i32');
      mod.ccall('duckdb_destroy_prepare', null, ['number'], [stmtPtrPtr]);
    } finally {
      mod._free(stmtPtrPtr);
    }
    this.closed = true;
    this.stmtPtr = 0;
  }
}

/**
 * A chunk of data from a streaming query result.
 * @category Query Results
 */
export class DataChunk {
  private chunkPtr: number;
  private destroyed = false;
  private readonly columns: ColumnInfo[];

  /** @internal */
  constructor(chunkPtr: number, columns: ColumnInfo[]) {
    this.chunkPtr = chunkPtr;
    this.columns = columns;
  }

  get rowCount(): number {
    if (this.destroyed) return 0;
    const mod = getModule();
    return mod.ccall('duckdb_data_chunk_get_size', 'number', ['number'], [this.chunkPtr]) as number;
  }

  get columnCount(): number {
    if (this.destroyed) return 0;
    const mod = getModule();
    return mod.ccall(
      'duckdb_data_chunk_get_column_count',
      'number',
      ['number'],
      [this.chunkPtr],
    ) as number;
  }

  getColumnInfo(): ColumnInfo[] {
    return this.columns;
  }

  getColumn(columnIndex: number): unknown[] {
    if (this.destroyed) throw new DuckDBError('DataChunk has been destroyed');
    const mod = getModule();
    const rows = this.rowCount;

    const vectorPtr = mod.ccall(
      'duckdb_data_chunk_get_vector',
      'number',
      ['number', 'number'],
      [this.chunkPtr, columnIndex],
    ) as number;

    if (!vectorPtr) throw new DuckDBError(`Failed to get vector for column ${columnIndex}`);

    const dataPtr = mod.ccall(
      'duckdb_vector_get_data',
      'number',
      ['number'],
      [vectorPtr],
    ) as number;
    const validityPtr = mod.ccall(
      'duckdb_vector_get_validity',
      'number',
      ['number'],
      [vectorPtr],
    ) as number;

    const columnType = this.columns[columnIndex]?.type ?? DuckDBType.VARCHAR;
    return this.readVectorData(dataPtr, validityPtr, rows, columnType);
  }

  toArray<T = Record<string, unknown>>(): T[] {
    if (this.destroyed) return [];
    const rows = this.rowCount;
    const cols = this.columnCount;

    const columnData: unknown[][] = [];
    for (let c = 0; c < cols; c++) {
      columnData.push(this.getColumn(c));
    }

    const result: T[] = new Array(rows);
    for (let r = 0; r < rows; r++) {
      const row: Record<string, unknown> = {};
      for (let c = 0; c < cols; c++) {
        row[this.columns[c].name] = columnData[c][r];
      }
      result[r] = row as T;
    }
    return result;
  }

  private readVectorData(
    dataPtr: number,
    validityPtr: number,
    rowCount: number,
    duckdbType: number,
  ): unknown[] {
    const mod = getModule();
    const result: unknown[] = new Array(rowCount);

    const isRowNull = (rowIdx: number): boolean => {
      if (validityPtr === 0) return false;
      return (
        (mod.ccall(
          'duckdb_validity_row_is_valid',
          'number',
          ['number', 'number'],
          [validityPtr, rowIdx],
        ) as number) === 0
      );
    };

    switch (duckdbType) {
      case DuckDBType.BOOLEAN:
        for (let i = 0; i < rowCount; i++) {
          result[i] = isRowNull(i) ? null : mod.HEAPU8[dataPtr + i] !== 0;
        }
        break;

      case DuckDBType.TINYINT:
        for (let i = 0; i < rowCount; i++) {
          result[i] = isRowNull(i) ? null : mod.HEAP8[dataPtr + i];
        }
        break;

      case DuckDBType.SMALLINT: {
        const offset = dataPtr >> 1;
        for (let i = 0; i < rowCount; i++) {
          result[i] = isRowNull(i) ? null : mod.HEAP16[offset + i];
        }
        break;
      }

      case DuckDBType.INTEGER: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          result[i] = isRowNull(i) ? null : mod.HEAP32[offset + i];
        }
        break;
      }

      case DuckDBType.BIGINT: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          if (isRowNull(i)) {
            result[i] = null;
          } else {
            const low = mod.HEAPU32[offset + i * 2];
            const high = mod.HEAP32[offset + i * 2 + 1];
            result[i] = high * 0x100000000 + low;
          }
        }
        break;
      }

      case DuckDBType.FLOAT: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          result[i] = isRowNull(i) ? null : mod.HEAPF32[offset + i];
        }
        break;
      }

      case DuckDBType.DOUBLE: {
        const offset = dataPtr >> 3;
        for (let i = 0; i < rowCount; i++) {
          result[i] = isRowNull(i) ? null : mod.HEAPF64[offset + i];
        }
        break;
      }

      case DuckDBType.DATE: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          if (isRowNull(i)) {
            result[i] = null;
          } else {
            const days = mod.HEAP32[offset + i];
            const date = new Date(days * 24 * 60 * 60 * 1000);
            result[i] = date.toISOString().split('T')[0];
          }
        }
        break;
      }

      case DuckDBType.TIMESTAMP:
      case DuckDBType.TIMESTAMP_TZ: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          if (isRowNull(i)) {
            result[i] = null;
          } else {
            const low = mod.HEAPU32[offset + i * 2];
            const high = mod.HEAP32[offset + i * 2 + 1];
            const micros = high * 0x100000000 + low;
            const date = new Date(micros / 1000);
            result[i] = date.toISOString();
          }
        }
        break;
      }

      default:
        for (let i = 0; i < rowCount; i++) {
          if (isRowNull(i)) {
            result[i] = null;
          } else {
            const strBase = dataPtr + i * 16;
            const length = mod.HEAP32[strBase >> 2];

            if (length <= 12) {
              let str = '';
              for (let j = 0; j < length; j++) {
                str += String.fromCharCode(mod.HEAPU8[strBase + 4 + j]);
              }
              result[i] = str;
            } else {
              const strPtr = mod.HEAP32[(strBase + 8) >> 2];
              result[i] = mod.UTF8ToString(strPtr);
            }
          }
        }
        break;
    }

    return result;
  }

  destroy(): void {
    if (this.destroyed) return;
    const mod = getModule();
    const chunkPtrPtr = mod._malloc(4);
    try {
      mod.setValue(chunkPtrPtr, this.chunkPtr, 'i32');
      mod.ccall('duckdb_destroy_data_chunk', null, ['number'], [chunkPtrPtr]);
    } finally {
      mod._free(chunkPtrPtr);
    }
    this.destroyed = true;
    this.chunkPtr = 0;
  }
}

/**
 * A streaming query result that yields data in chunks.
 * @category Query Results
 */
export class StreamingResult implements Iterable<DataChunk> {
  private resultPtr: number;
  private closed = false;
  private readonly columns: ColumnInfo[];
  private currentChunkIndex = 0;
  private readonly totalChunks: number;

  /** @internal */
  constructor(resultPtr: number, columns: ColumnInfo[]) {
    this.resultPtr = resultPtr;
    this.columns = columns;

    const mod = getModule();
    this.totalChunks = mod.ccall(
      'duckdb_result_chunk_count',
      'number',
      ['number'],
      [resultPtr],
    ) as number;
  }

  getColumns(): ColumnInfo[] {
    return this.columns;
  }

  get columnCount(): number {
    return this.columns.length;
  }

  get chunkCount(): number {
    return this.totalChunks;
  }

  nextChunk(): DataChunk | null {
    if (this.closed || this.currentChunkIndex >= this.totalChunks) {
      return null;
    }

    const mod = getModule();
    const chunkPtr = mod.ccall(
      'duckdb_result_get_chunk',
      'number',
      ['number', 'number'],
      [this.resultPtr, this.currentChunkIndex],
    ) as number;

    if (!chunkPtr) return null;

    this.currentChunkIndex++;
    return new DataChunk(chunkPtr, this.columns);
  }

  reset(): void {
    this.currentChunkIndex = 0;
  }

  *[Symbol.iterator](): Iterator<DataChunk> {
    this.reset();
    let chunk: DataChunk | null;
    while ((chunk = this.nextChunk()) !== null) {
      try {
        yield chunk;
      } finally {
        chunk.destroy();
      }
    }
  }

  toArray<T = Record<string, unknown>>(): T[] {
    const allRows: T[] = [];
    for (const chunk of this) {
      allRows.push(...chunk.toArray<T>());
    }
    return allRows;
  }

  toArrowTable(): Table {
    const columnData: Record<string, unknown[]> = {};
    const types: Record<string, DataType> = {};

    for (const col of this.columns) {
      columnData[col.name] = [];
      types[col.name] = this.getFlechetteType(col.type);
    }

    for (const chunk of this) {
      for (let c = 0; c < this.columns.length; c++) {
        const colName = this.columns[c].name;
        const chunkData = chunk.getColumn(c);
        columnData[colName].push(...chunkData);
      }
    }

    return tableFromArrays(columnData, { types });
  }

  private getFlechetteType(duckdbType: DuckDBTypeId): DataType {
    switch (duckdbType) {
      case DuckDBType.BOOLEAN:
        return bool();
      case DuckDBType.TINYINT:
        return int8();
      case DuckDBType.SMALLINT:
        return int16();
      case DuckDBType.INTEGER:
        return int32();
      case DuckDBType.BIGINT:
        return int64();
      case DuckDBType.UTINYINT:
        return uint8();
      case DuckDBType.USMALLINT:
        return uint16();
      case DuckDBType.UINTEGER:
        return uint32();
      case DuckDBType.UBIGINT:
        return uint64();
      case DuckDBType.FLOAT:
        return float32();
      case DuckDBType.DOUBLE:
        return float64();
      case DuckDBType.VARCHAR:
        return utf8();
      case DuckDBType.DATE:
        return dateDay();
      case DuckDBType.TIMESTAMP:
      case DuckDBType.TIMESTAMP_TZ:
        return timestamp(TimeUnit.MICROSECOND);
      default:
        return utf8();
    }
  }

  close(): void {
    if (this.closed) return;
    const mod = getModule();
    mod.ccall('duckdb_destroy_result', null, ['number'], [this.resultPtr]);
    this.closed = true;
    this.resultPtr = 0;
  }
}

/**
 * DuckDB database instance for Cloudflare Workers.
 *
 * @category Database
 * @example
 * ```typescript
 * import { init, DuckDB, AccessMode } from '@ducklings/workers';
 * import wasmModule from '@ducklings/workers/wasm';
 *
 * await init({ wasmModule });
 *
 * // Default configuration (httpfs enabled, config locked)
 * const db = new DuckDB();
 *
 * // Or with custom security configuration
 * const secureDb = new DuckDB({
 *   accessMode: AccessMode.READ_ONLY,
 *   lockConfiguration: true,
 * });
 *
 * const conn = db.connect();
 * const result = await conn.query('SELECT 42 as answer');
 * console.log(result);
 *
 * conn.close();
 * db.close();
 * ```
 */
export class DuckDB {
  private dbPtr: number = 0;
  private closed: boolean = false;

  /**
   * Creates a new DuckDB database instance.
   *
   * @param config - Optional configuration options
   */
  constructor(config: DuckDBConfig = {}) {
    if (!module) {
      throw new DuckDBError('DuckDB WASM not initialized. Call init() first.');
    }

    // Store module reference for use in closures
    const mod = module;

    // Apply defaults
    const finalConfig = {
      accessMode: config.accessMode ?? AccessMode.AUTOMATIC,
      enableExternalAccess: config.enableExternalAccess ?? true,
      lockConfiguration: config.lockConfiguration ?? true,
      customConfig: config.customConfig ?? {},
    };

    // Create config object
    const configPtrPtr = mod._malloc(4);
    const result = mod.ccall(
      'duckdb_create_config',
      'number',
      ['number'],
      [configPtrPtr],
    ) as number;

    if (result !== 0) {
      mod._free(configPtrPtr);
      throw new DuckDBError('Failed to create DuckDB configuration');
    }

    const configPtr = mod.getValue(configPtrPtr, 'i32');
    mod._free(configPtrPtr);

    try {
      // Helper to set config option
      const setConfig = (name: string, value: string) => {
        const setResult = mod.ccall(
          'duckdb_set_config',
          'number',
          ['number', 'string', 'string'],
          [configPtr, name, value],
        ) as number;
        if (setResult !== 0) {
          throw new DuckDBError(`Failed to set config option: ${name}`);
        }
      };

      // Apply access mode
      if (finalConfig.accessMode !== AccessMode.AUTOMATIC) {
        setConfig('access_mode', finalConfig.accessMode);
      }

      // Apply external access setting
      if (finalConfig.enableExternalAccess === false) {
        setConfig('enable_external_access', 'false');
      }

      // Apply custom config options
      for (const [key, value] of Object.entries(finalConfig.customConfig)) {
        setConfig(key, value);
      }

      // Open database with config
      const dbPtrPtr = mod._malloc(4);
      const errorPtrPtr = mod._malloc(4);

      try {
        const openResult = mod.ccall(
          'duckdb_open_ext',
          'number',
          ['string', 'number', 'number', 'number'],
          [':memory:', dbPtrPtr, configPtr, errorPtrPtr],
        ) as number;

        if (openResult !== 0) {
          const errorPtr = mod.getValue(errorPtrPtr, 'i32');
          const errorMsg = errorPtr ? mod.UTF8ToString(errorPtr) : 'Unknown error';
          throw new DuckDBError(`Failed to open database: ${errorMsg}`);
        }

        this.dbPtr = mod.getValue(dbPtrPtr, 'i32');
      } finally {
        mod._free(dbPtrPtr);
        mod._free(errorPtrPtr);
      }

      // Initialize httpfs (only if external access enabled)
      if (finalConfig.enableExternalAccess !== false) {
        mod.ccall('duckdb_wasm_httpfs_init', null, ['number'], [this.dbPtr]);
      }

      // Lock configuration (secure default)
      if (finalConfig.lockConfiguration !== false) {
        // Use direct ccall for synchronous execution during construction
        const connPtrPtr = mod._malloc(4);
        try {
          const connResult = mod.ccall(
            'duckdb_connect',
            'number',
            ['number', 'number'],
            [this.dbPtr, connPtrPtr],
          ) as number;

          if (connResult === 0) {
            const connPtr = mod.getValue(connPtrPtr, 'i32');
            const resultPtr = mod._malloc(64);
            try {
              mod.ccall(
                'duckdb_query',
                'number',
                ['number', 'string', 'number'],
                [connPtr, 'SET lock_configuration = true', resultPtr],
              );
              mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
            } finally {
              mod._free(resultPtr);
            }
            mod.ccall('duckdb_disconnect', null, ['number'], [connPtrPtr]);
          }
        } finally {
          mod._free(connPtrPtr);
        }
      }
    } finally {
      // Destroy config object
      const configPtrPtrForDestroy = mod._malloc(4);
      mod.setValue(configPtrPtrForDestroy, configPtr, 'i32');
      mod.ccall('duckdb_destroy_config', null, ['number'], [configPtrPtrForDestroy]);
      mod._free(configPtrPtrForDestroy);
    }
  }

  /**
   * Creates a new DuckDB database instance asynchronously.
   *
   * @param config - Optional configuration options
   */
  static async create(config?: DuckDBConfig): Promise<DuckDB> {
    return new DuckDB(config);
  }

  connect(): Connection {
    if (this.closed || !module) {
      throw new DuckDBError('Database is closed');
    }

    const connPtrPtr = module._malloc(4);
    try {
      const result = module.ccall(
        'duckdb_connect',
        'number',
        ['number', 'number'],
        [this.dbPtr, connPtrPtr],
      ) as number;

      if (result !== 0) {
        throw new DuckDBError('Failed to create connection');
      }

      const connPtr = module.getValue(connPtrPtr, '*');
      return new Connection(connPtr);
    } finally {
      module._free(connPtrPtr);
    }
  }

  close(): void {
    if (this.closed || !module) return;

    const dbPtrPtr = module._malloc(4);
    try {
      module.setValue(dbPtrPtr, this.dbPtr, '*');
      module.ccall('duckdb_close', null, ['number'], [dbPtrPtr]);
    } finally {
      module._free(dbPtrPtr);
    }

    this.closed = true;
    this.dbPtr = 0;
  }
}

/**
 * A connection to a DuckDB database (async API for Cloudflare Workers).
 *
 * All query methods in this class are async and return Promises.
 * @category Connection
 */
export class Connection {
  private connPtr: number;
  private closed: boolean = false;

  /** @internal */
  constructor(connPtr: number) {
    this.connPtr = connPtr;
  }

  /**
   * Executes a SQL query and returns the results.
   * This is async to support httpfs in Cloudflare Workers.
   *
   * @param sql - The SQL query to execute
   * @returns Promise resolving to array of result rows as objects
   */
  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    if (this.closed || !module) {
      throw new DuckDBError('Connection is closed');
    }

    const resultPtr = module._malloc(64);
    try {
      const status = (await module.ccall(
        'duckdb_query',
        'number',
        ['number', 'string', 'number'],
        [this.connPtr, sql, resultPtr],
        { async: true },
      )) as number;

      if (status !== 0) {
        const errorPtr = module.ccall(
          'duckdb_result_error',
          'number',
          ['number'],
          [resultPtr],
        ) as number;

        const error = errorPtr ? module.UTF8ToString(errorPtr) : 'Query failed';
        module.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new DuckDBError(error, undefined, sql);
      }

      const columnCount = module.ccall(
        'duckdb_column_count',
        'number',
        ['number'],
        [resultPtr],
      ) as number;

      const columns: { name: string; type: number }[] = [];
      for (let i = 0; i < columnCount; i++) {
        const namePtr = module.ccall(
          'duckdb_column_name',
          'number',
          ['number', 'number'],
          [resultPtr, i],
        ) as number;

        const type = module.ccall(
          'duckdb_column_type',
          'number',
          ['number', 'number'],
          [resultPtr, i],
        ) as number;

        columns.push({
          name: module.UTF8ToString(namePtr),
          type,
        });
      }

      const rowCount = module.ccall(
        'duckdb_row_count',
        'number',
        ['number'],
        [resultPtr],
      ) as number;

      const columnData: unknown[][] = [];
      for (let colIdx = 0; colIdx < columnCount; colIdx++) {
        const col = columns[colIdx];

        const dataPtr = module.ccall(
          'duckdb_column_data',
          'number',
          ['number', 'number'],
          [resultPtr, colIdx],
        ) as number;

        const nullmaskPtr = module.ccall(
          'duckdb_nullmask_data',
          'number',
          ['number', 'number'],
          [resultPtr, colIdx],
        ) as number;

        if (col.type === DuckDBType.VARCHAR || dataPtr === 0) {
          const values: unknown[] = new Array(rowCount);
          for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
            const isNull = module.ccall(
              'duckdb_value_is_null',
              'number',
              ['number', 'number', 'number', 'number', 'number'],
              [resultPtr, colIdx, 0, rowIdx, 0],
            ) as number;

            if (isNull) {
              values[rowIdx] = null;
            } else {
              const strPtr = module.ccall(
                'duckdb_value_varchar',
                'number',
                ['number', 'number', 'number', 'number', 'number'],
                [resultPtr, colIdx, 0, rowIdx, 0],
              ) as number;
              if (strPtr) {
                values[rowIdx] = module.UTF8ToString(strPtr);
                module._free(strPtr);
              } else {
                values[rowIdx] = null;
              }
            }
          }
          columnData.push(values);
        } else {
          columnData.push(this.readColumnData(dataPtr, nullmaskPtr, rowCount, col.type));
        }
      }

      const rows: T[] = new Array(rowCount);
      for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
        const row: Record<string, unknown> = {};
        for (let colIdx = 0; colIdx < columnCount; colIdx++) {
          row[columns[colIdx].name] = columnData[colIdx][rowIdx];
        }
        rows[rowIdx] = row as T;
      }

      module.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);

      return rows;
    } finally {
      module._free(resultPtr);
    }
  }

  private readColumnData(
    dataPtr: number,
    nullmaskPtr: number,
    rowCount: number,
    duckdbType: number,
  ): unknown[] {
    if (!module) return [];

    const result: unknown[] = new Array(rowCount);
    const hasNullmask = nullmaskPtr !== 0;

    switch (duckdbType) {
      case DuckDBType.BOOLEAN: {
        const boolPtr = dataPtr;
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            result[i] = module.HEAPU8[boolPtr + i] !== 0;
          }
        }
        break;
      }

      case DuckDBType.TINYINT: {
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            result[i] = module.HEAP8[dataPtr + i];
          }
        }
        break;
      }

      case DuckDBType.SMALLINT: {
        const offset = dataPtr >> 1;
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            result[i] = module.HEAP16[offset + i];
          }
        }
        break;
      }

      case DuckDBType.INTEGER: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            result[i] = module.HEAP32[offset + i];
          }
        }
        break;
      }

      case DuckDBType.BIGINT: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            const low = module.HEAPU32[offset + i * 2];
            const high = module.HEAP32[offset + i * 2 + 1];
            // Check if value fits in safe integer range before computing
            if (high === 0 && low <= 0x1fffffffffffff) {
              result[i] = low;
            } else if (high === -1 && low >= 0x80000000) {
              // Small negative number
              result[i] = high * 0x100000000 + low;
            } else {
              // Large value - return as string for JSON compatibility
              const bigValue = BigInt(high) * BigInt(0x100000000) + BigInt(low >>> 0);
              result[i] = bigValue.toString();
            }
          }
        }
        break;
      }

      case DuckDBType.UTINYINT: {
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            result[i] = module.HEAPU8[dataPtr + i];
          }
        }
        break;
      }

      case DuckDBType.USMALLINT: {
        const offset = dataPtr >> 1;
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            result[i] = module.HEAPU16[offset + i];
          }
        }
        break;
      }

      case DuckDBType.UINTEGER: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            result[i] = module.HEAPU32[offset + i];
          }
        }
        break;
      }

      case DuckDBType.UBIGINT: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            const low = module.HEAPU32[offset + i * 2];
            const high = module.HEAPU32[offset + i * 2 + 1];
            // Check if value fits in safe integer range before computing
            if (high === 0 && low <= 0x1fffffffffffff) {
              result[i] = low;
            } else {
              // Large value - return as string for JSON compatibility
              const bigValue = BigInt(high) * BigInt(0x100000000) + BigInt(low);
              result[i] = bigValue.toString();
            }
          }
        }
        break;
      }

      case DuckDBType.FLOAT: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            result[i] = module.HEAPF32[offset + i];
          }
        }
        break;
      }

      case DuckDBType.DOUBLE: {
        const offset = dataPtr >> 3;
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            result[i] = module.HEAPF64[offset + i];
          }
        }
        break;
      }

      case DuckDBType.DATE: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            const days = module.HEAP32[offset + i];
            const date = new Date(days * 24 * 60 * 60 * 1000);
            result[i] = date.toISOString().split('T')[0];
          }
        }
        break;
      }

      case DuckDBType.TIMESTAMP:
      case DuckDBType.TIMESTAMP_TZ: {
        const offset = dataPtr >> 2;
        for (let i = 0; i < rowCount; i++) {
          if (hasNullmask && module.HEAPU8[nullmaskPtr + i]) {
            result[i] = null;
          } else {
            // Timestamp is stored as microseconds since epoch
            const low = module.HEAPU32[offset + i * 2];
            const high = module.HEAP32[offset + i * 2 + 1];
            const micros = BigInt(high) * BigInt(0x100000000) + BigInt(low >>> 0);
            const millis = Number(micros / BigInt(1000));
            const date = new Date(millis);
            result[i] = date.toISOString();
          }
        }
        break;
      }

      default:
        for (let i = 0; i < rowCount; i++) {
          result[i] = null;
        }
        break;
    }

    return result;
  }

  /**
   * Executes a SQL query and returns results as an Arrow table.
   *
   * @param sql - The SQL query to execute
   * @returns Promise resolving to Arrow Table
   */
  async queryArrow(sql: string): Promise<Table> {
    if (this.closed || !module) {
      throw new DuckDBError('Connection is closed');
    }

    const resultPtr = module._malloc(64);
    try {
      const status = (await module.ccall(
        'duckdb_query',
        'number',
        ['number', 'string', 'number'],
        [this.connPtr, sql, resultPtr],
        { async: true },
      )) as number;

      if (status !== 0) {
        const errorPtr = module.ccall(
          'duckdb_result_error',
          'number',
          ['number'],
          [resultPtr],
        ) as number;
        const error = errorPtr ? module.UTF8ToString(errorPtr) : 'Query failed';
        module.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new DuckDBError(error, undefined, sql);
      }

      const columnCount = module.ccall(
        'duckdb_column_count',
        'number',
        ['number'],
        [resultPtr],
      ) as number;

      const rowCount = module.ccall(
        'duckdb_row_count',
        'number',
        ['number'],
        [resultPtr],
      ) as number;

      const columns: { name: string; type: number; flechetteType: DataType }[] = [];
      for (let i = 0; i < columnCount; i++) {
        const namePtr = module.ccall(
          'duckdb_column_name',
          'number',
          ['number', 'number'],
          [resultPtr, i],
        ) as number;

        const type = module.ccall(
          'duckdb_column_type',
          'number',
          ['number', 'number'],
          [resultPtr, i],
        ) as number;

        columns.push({
          name: module.UTF8ToString(namePtr),
          type,
          flechetteType: this.getFlechetteType(type) || utf8(),
        });
      }

      const tableData: Record<string, unknown[]> = {};
      const types: Record<string, DataType> = {};

      for (let colIdx = 0; colIdx < columnCount; colIdx++) {
        const col = columns[colIdx];

        const dataPtr = module.ccall(
          'duckdb_column_data',
          'number',
          ['number', 'number'],
          [resultPtr, colIdx],
        ) as number;

        const nullmaskPtr = module.ccall(
          'duckdb_nullmask_data',
          'number',
          ['number', 'number'],
          [resultPtr, colIdx],
        ) as number;

        if (col.type === DuckDBType.VARCHAR || dataPtr === 0) {
          const values: unknown[] = new Array(rowCount);
          for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
            const isNull = module.ccall(
              'duckdb_value_is_null',
              'number',
              ['number', 'number', 'number', 'number', 'number'],
              [resultPtr, colIdx, 0, rowIdx, 0],
            ) as number;

            if (isNull) {
              values[rowIdx] = null;
            } else {
              const strPtr = module.ccall(
                'duckdb_value_varchar',
                'number',
                ['number', 'number', 'number', 'number', 'number'],
                [resultPtr, colIdx, 0, rowIdx, 0],
              ) as number;
              if (strPtr) {
                values[rowIdx] = module.UTF8ToString(strPtr);
                module._free(strPtr);
              } else {
                values[rowIdx] = null;
              }
            }
          }
          tableData[col.name] = values;
        } else {
          tableData[col.name] = this.readColumnData(dataPtr, nullmaskPtr, rowCount, col.type);
        }

        types[col.name] = col.flechetteType;
      }

      module.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);

      return tableFromArrays(tableData, { types });
    } finally {
      module._free(resultPtr);
    }
  }

  private getFlechetteType(duckdbType: number): DataType | null {
    switch (duckdbType) {
      case DuckDBType.BOOLEAN:
        return bool();
      case DuckDBType.TINYINT:
        return int8();
      case DuckDBType.SMALLINT:
        return int16();
      case DuckDBType.INTEGER:
        return int32();
      case DuckDBType.BIGINT:
        return int64();
      case DuckDBType.UTINYINT:
        return uint8();
      case DuckDBType.USMALLINT:
        return uint16();
      case DuckDBType.UINTEGER:
        return uint32();
      case DuckDBType.UBIGINT:
        return uint64();
      case DuckDBType.FLOAT:
        return float32();
      case DuckDBType.DOUBLE:
        return float64();
      case DuckDBType.VARCHAR:
        return utf8();
      case DuckDBType.DATE:
        return dateDay();
      case DuckDBType.TIMESTAMP:
      case DuckDBType.TIMESTAMP_TZ:
        return timestamp(TimeUnit.MICROSECOND);
      default:
        return utf8();
    }
  }

  /**
   * Executes a SQL statement without returning results.
   *
   * @param sql - The SQL statement to execute
   * @returns Promise resolving to number of rows affected
   */
  async execute(sql: string): Promise<number> {
    if (this.closed || !module) {
      throw new DuckDBError('Connection is closed');
    }

    const resultPtr = module._malloc(64);
    try {
      const status = (await module.ccall(
        'duckdb_query',
        'number',
        ['number', 'string', 'number'],
        [this.connPtr, sql, resultPtr],
        { async: true },
      )) as number;

      if (status !== 0) {
        const errorPtr = module.ccall(
          'duckdb_result_error',
          'number',
          ['number'],
          [resultPtr],
        ) as number;

        const error = errorPtr ? module.UTF8ToString(errorPtr) : 'Query failed';
        module.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new DuckDBError(error, undefined, sql);
      }

      const rowsChanged = module.ccall(
        'duckdb_rows_changed',
        'number',
        ['number'],
        [resultPtr],
      ) as number;

      module.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
      return rowsChanged;
    } finally {
      module._free(resultPtr);
    }
  }

  /**
   * Creates a prepared statement for the given SQL.
   *
   * @param sql - The SQL statement to prepare (use ? for parameters)
   * @returns A PreparedStatement instance
   */
  prepare(sql: string): PreparedStatement {
    if (this.closed || !module) {
      throw new DuckDBError('Connection is closed');
    }

    const stmtPtrPtr = module._malloc(4);
    try {
      const result = module.ccall(
        'duckdb_prepare',
        'number',
        ['number', 'string', 'number'],
        [this.connPtr, sql, stmtPtrPtr],
      ) as number;

      if (result !== 0) {
        const stmtPtr = module.getValue(stmtPtrPtr, '*');
        if (stmtPtr) {
          const errorPtr = module.ccall(
            'duckdb_prepare_error',
            'number',
            ['number'],
            [stmtPtr],
          ) as number;
          const error = errorPtr ? module.UTF8ToString(errorPtr) : 'Failed to prepare statement';
          module.ccall('duckdb_destroy_prepare', null, ['number'], [stmtPtr]);
          throw new DuckDBError(error, undefined, sql);
        }
        throw new DuckDBError('Failed to prepare statement', undefined, sql);
      }

      const stmtPtr = module.getValue(stmtPtrPtr, '*');
      return new PreparedStatement(stmtPtr, this.connPtr, sql);
    } finally {
      module._free(stmtPtrPtr);
    }
  }

  async beginTransaction(): Promise<void> {
    await this.execute('BEGIN TRANSACTION');
  }

  async commit(): Promise<void> {
    await this.execute('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.execute('ROLLBACK');
  }

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

  close(): void {
    if (this.closed || !module) return;

    const connPtrPtr = module._malloc(4);
    try {
      module.setValue(connPtrPtr, this.connPtr, '*');
      module.ccall('duckdb_disconnect', null, ['number'], [connPtrPtr]);
    } finally {
      module._free(connPtrPtr);
    }

    this.closed = true;
    this.connPtr = 0;
  }
}

// Re-export Flechette types and utilities
export type { Table } from '@uwdata/flechette';
export { tableFromArrays, tableFromIPC, tableToIPC } from '@uwdata/flechette';
