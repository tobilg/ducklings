/**
 * Async DuckDB bindings for the main thread
 *
 * @packageDocumentation
 */

import type { InitOptions, FileInfo } from '../types.js';
import { DuckDBError } from '../errors.js';
import {
  WorkerRequestType,
  WorkerResponseType,
  WorkerTask,
  type WorkerRequest,
  type WorkerResponse,
  type ErrorResponse,
  type ConnectionIdResponse,
  type VersionResponse,
  type FileBufferResponse,
  type FileInfoListResponse,
} from '../worker/protocol.js';
import { Connection } from './connection.js';

// Module state
let globalDB: DuckDB | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the DuckDB WASM module.
 *
 * This function must be called before creating any DuckDB instances.
 * It spawns a Web Worker and initializes the WebAssembly module inside it.
 *
 * URLs for worker, WASM, and JS files are automatically resolved from the
 * library location. You can override them if needed.
 *
 * @category Database
 * @param options - Optional initialization options
 * @returns Promise that resolves when initialization is complete
 *
 * @example
 * ```typescript
 * import { init, getDB } from '@ducklings/browser';
 *
 * await init();
 * const db = getDB();
 * const conn = await db.connect();
 *
 * const rows = await conn.query('SELECT 42 as answer');
 * console.log(rows);
 *
 * await conn.close();
 * await db.close();
 * ```
 */
export async function init(options?: string | InitOptions): Promise<void> {
  if (globalDB) {
    return;
  }

  if (initPromise) {
    await initPromise;
    return;
  }

  // Normalize options
  const opts: InitOptions = typeof options === 'string' ? { wasmUrl: options } : (options ?? {});

  initPromise = (async () => {
    // Auto-resolve URLs from library location if not provided
    const baseUrl = new URL('.', import.meta.url).href;
    const workerUrl = opts.workerUrl ?? new URL('worker.js', baseUrl).href;
    const wasmUrl = opts.wasmUrl ?? new URL('wasm/duckdb.wasm', baseUrl).href;
    const wasmJsUrl = opts.wasmJsUrl ?? new URL('wasm/duckdb.js', baseUrl).href;

    // Create worker
    const worker = new Worker(workerUrl, { type: 'module' });

    // Wait for worker to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new DuckDBError('Worker initialization timeout'));
      }, 30000);

      const handler = (event: MessageEvent) => {
        if (event.data?.type === 'WORKER_READY') {
          clearTimeout(timeout);
          worker.removeEventListener('message', handler);
          resolve();
        }
      };
      worker.addEventListener('message', handler);
    });

    // Create the global DB instance
    globalDB = new DuckDB(worker);

    // Instantiate WASM in worker
    await globalDB.instantiate(wasmUrl, wasmJsUrl);

    // Open database
    await globalDB.open();
  })();

  await initPromise;
}

/**
 * Returns the DuckDB library version.
 *
 * @category Database
 * @returns Promise resolving to version string
 * @throws DuckDBError if WASM module is not initialized
 */
export async function version(): Promise<string> {
  if (!globalDB) {
    throw new DuckDBError('DuckDB WASM not initialized. Call init() first.');
  }
  return globalDB.getVersion();
}

/**
 * Get the global DuckDB instance.
 *
 * @category Database
 * @returns The global DuckDB instance
 * @throws DuckDBError if not initialized
 */
export function getDB(): DuckDB {
  if (!globalDB) {
    throw new DuckDBError('DuckDB WASM not initialized. Call init() first.');
  }
  return globalDB;
}

/**
 * DuckDB database instance.
 *
 * This is the main entry point for using DuckDB in WASM.
 * Create a database instance, then create connections to execute queries.
 *
 * @category Database
 * @example
 * ```typescript
 * import { init, DuckDB } from '@ducklings/browser';
 *
 * await init();
 *
 * const db = new DuckDB();
 * const conn = await db.connect();
 *
 * const result = await conn.query('SELECT 42 as answer');
 * console.log(result);
 *
 * await conn.close();
 * await db.close();
 * ```
 */
export class DuckDB {
  private worker: Worker;
  private pendingRequests: Map<number, WorkerTask> = new Map();
  private nextMessageId = 1;
  private closed = false;

  /**
   * Creates a new DuckDB instance.
   *
   * @param worker - The Web Worker to use for DuckDB operations
   * @internal Use init() instead of creating directly
   */
  constructor(worker?: Worker) {
    if (worker) {
      this.worker = worker;
      this.setupMessageHandler();
    } else {
      // Use global worker
      if (!globalDB) {
        throw new DuckDBError('DuckDB WASM not initialized. Call init() first.');
      }
      this.worker = globalDB.worker;
      this.pendingRequests = globalDB.pendingRequests;
      this.nextMessageId = globalDB.nextMessageId;
    }
  }

  private setupMessageHandler(): void {
    this.worker.onmessage = (event: MessageEvent) => {
      const response = event.data as WorkerResponse;
      const task = this.pendingRequests.get(response.requestId);

      if (task) {
        this.pendingRequests.delete(response.requestId);

        if (response.type === WorkerResponseType.ERROR) {
          const errorData = response.data as ErrorResponse;
          task.reject(new DuckDBError(errorData.message, errorData.code, errorData.query));
        } else {
          task.resolve(response.data);
        }
      }
    };

    this.worker.onerror = (error: ErrorEvent) => {
      // Reject all pending requests
      for (const [, task] of this.pendingRequests) {
        task.reject(new DuckDBError(`Worker error: ${error.message}`));
      }
      this.pendingRequests.clear();
    };
  }

  /**
   * Post a request to the worker and return a promise for the response.
   *
   * @internal
   */
  postTask<T>(
    type: WorkerRequestType,
    data?: unknown,
    transfer?: Transferable[],
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new DuckDBError('Database is closed'));
    }

    const messageId = this.nextMessageId++;
    const task = new WorkerTask<T>(messageId, type);
    this.pendingRequests.set(messageId, task as WorkerTask);

    const request: WorkerRequest = {
      messageId,
      type,
      data,
    };

    if (transfer && transfer.length > 0) {
      this.worker.postMessage(request, transfer);
    } else {
      this.worker.postMessage(request);
    }

    return task.promise;
  }

  /**
   * Instantiate the WASM module in the worker.
   *
   * @internal
   */
  async instantiate(wasmUrl?: string, wasmJsUrl?: string): Promise<void> {
    await this.postTask(WorkerRequestType.INSTANTIATE, { wasmUrl, wasmJsUrl });
  }

  /**
   * Open the database.
   *
   * @internal
   */
  async open(): Promise<void> {
    await this.postTask(WorkerRequestType.OPEN);
  }

  /**
   * Get the DuckDB library version.
   */
  async getVersion(): Promise<string> {
    const response = await this.postTask<VersionResponse>(WorkerRequestType.GET_VERSION);
    return response.version;
  }

  /**
   * Creates a new connection to this database.
   *
   * Multiple connections can be created to the same database.
   * Each connection maintains its own transaction state.
   *
   * @returns Promise resolving to a new Connection instance
   */
  async connect(): Promise<Connection> {
    const response = await this.postTask<ConnectionIdResponse>(WorkerRequestType.CONNECT);
    return new Connection(this, response.connectionId);
  }

  /**
   * Creates a new DuckDB database and initializes the WASM module if needed.
   *
   * This is a convenience method that combines init() and connect().
   *
   * @returns Promise that resolves to a new Connection instance
   *
   * @example
   * ```typescript
   * const conn = await DuckDB.createConnection();
   * const rows = await conn.query('SELECT 42 as answer');
   * ```
   */
  static async createConnection(): Promise<Connection> {
    await init();
    return getDB().connect();
  }

  // ============================================================================
  // File Registration
  // ============================================================================

  /**
   * Register a remote file by URL.
   *
   * @param name - The virtual file name to use
   * @param url - The URL to fetch the file from
   * @param protocol - Optional protocol hint ('HTTP' or 'HTTPS')
   * @param directIO - Whether to use direct I/O
   *
   * @example
   * ```typescript
   * await db.registerFileURL('data.parquet', 'https://example.com/data.parquet');
   * const rows = await conn.query("SELECT * FROM 'data.parquet'");
   * ```
   */
  async registerFileURL(
    name: string,
    url: string,
    protocol?: string,
    directIO?: boolean,
  ): Promise<void> {
    await this.postTask(WorkerRequestType.REGISTER_FILE_URL, {
      name,
      url,
      protocol,
      directIO,
    });
  }

  /**
   * Register an in-memory buffer as a virtual file.
   *
   * @param name - The virtual file name to use
   * @param buffer - The file contents
   *
   * @example
   * ```typescript
   * const csvData = new TextEncoder().encode('id,name\n1,Alice\n2,Bob');
   * await db.registerFileBuffer('data.csv', csvData);
   * const rows = await conn.query("SELECT * FROM read_csv('/data.csv')");
   * ```
   */
  async registerFileBuffer(name: string, buffer: Uint8Array): Promise<void> {
    await this.postTask(
      WorkerRequestType.REGISTER_FILE_BUFFER,
      { name, buffer },
      [buffer.buffer],
    );
  }

  /**
   * Register a text string as a virtual file.
   *
   * @param name - The virtual file name to use
   * @param text - The file contents as a string
   */
  async registerFileText(name: string, text: string): Promise<void> {
    await this.postTask(WorkerRequestType.REGISTER_FILE_TEXT, { name, text });
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  /**
   * Remove a registered file.
   *
   * @param name - The virtual file name to remove
   */
  async dropFile(name: string): Promise<void> {
    await this.postTask(WorkerRequestType.DROP_FILE, { name });
  }

  /**
   * Remove all registered files.
   */
  async dropFiles(): Promise<void> {
    await this.postTask(WorkerRequestType.DROP_FILES);
  }

  /**
   * Flush all file buffers.
   */
  async flushFiles(): Promise<void> {
    await this.postTask(WorkerRequestType.FLUSH_FILES);
  }

  /**
   * Export a file to a buffer.
   *
   * @param name - The virtual file name to export
   * @returns The file contents
   */
  async copyFileToBuffer(name: string): Promise<Uint8Array> {
    const response = await this.postTask<FileBufferResponse>(
      WorkerRequestType.COPY_FILE_TO_BUFFER,
      { name },
    );
    return response.buffer;
  }

  /**
   * Copy a file to another path.
   *
   * @param srcName - The source file name
   * @param dstPath - The destination path
   */
  async copyFileToPath(srcName: string, dstPath: string): Promise<void> {
    await this.postTask(WorkerRequestType.COPY_FILE_TO_PATH, { srcName, dstPath });
  }

  /**
   * List files matching a glob pattern.
   *
   * @param pattern - The glob pattern to match
   * @returns List of matching files
   */
  async globFiles(pattern: string): Promise<FileInfo[]> {
    const response = await this.postTask<FileInfoListResponse>(
      WorkerRequestType.GLOB_FILES,
      { pattern },
    );
    return response.files;
  }

  /**
   * Closes the database and releases all resources.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    await this.postTask(WorkerRequestType.CLOSE);
    this.worker.terminate();
    this.closed = true;

    if (globalDB === this) {
      globalDB = null;
      initPromise = null;
    }
  }
}
