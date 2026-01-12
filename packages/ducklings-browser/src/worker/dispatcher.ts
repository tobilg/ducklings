/**
 * DuckDB Worker Dispatcher
 *
 * Handles incoming messages from the main thread and executes DuckDB operations.
 * @packageDocumentation
 */

import type { EmscriptenModule, ColumnInfo, DuckDBTypeId, DuckDBConfig } from '../types.js';
import { DuckDBType, AccessMode } from '../types.js';
import {
  WorkerRequestType,
  WorkerResponseType,
  type WorkerRequest,
  type WorkerResponse,
  type InstantiateRequest,
  type OpenRequest,
  type QueryRequest,
  type QueryArrowRequest,
  type QueryStreamingRequest,
  type ExecuteRequest,
  type FetchChunkRequest,
  type CloseStreamingResultRequest,
  type PrepareRequest,
  type RunPreparedRequest,
  type ExecutePreparedRequest,
  type ClosePreparedRequest,
  type TransactionRequest,
  type RegisterFileURLRequest,
  type RegisterFileBufferRequest,
  type RegisterFileTextRequest,
  type DropFileRequest,
  type CopyFileToBufferRequest,
  type CopyFileToPathRequest,
  type GlobFilesRequest,
  type InsertArrowFromIPCRequest,
  type InsertCSVFromPathRequest,
  type InsertJSONFromPathRequest,
  type DisconnectRequest,
  type ErrorResponse,
  type QueryResultResponse,
  type StreamingResultInfoResponse,
  type DataChunkResponse,
  type PreparedStatementBinding,
} from './protocol.js';

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
  TimeUnit,
  tableFromArrays,
  tableToIPC,
  timestamp,
  uint8,
  uint16,
  uint32,
  uint64,
  utf8,
} from '@uwdata/flechette';

/**
 * Stored prepared statement info.
 */
interface PreparedStatementInfo {
  stmtPtr: number;
  connectionId: number;
  sql: string;
}

/**
 * Stored streaming result info.
 */
interface StreamingResultInfo {
  resultPtr: number;
  connectionId: number;
  columns: ColumnInfo[];
  currentChunk: number;
}

/**
 * DuckDB Worker Dispatcher.
 *
 * Receives messages from the main thread, executes DuckDB operations,
 * and sends responses back.
 */
export class DuckDBDispatcher {
  private module: EmscriptenModule | null = null;
  private dbPtr: number = 0;
  private connections: Map<number, number> = new Map();
  private preparedStatements: Map<number, PreparedStatementInfo> = new Map();
  private streamingResults: Map<number, StreamingResultInfo> = new Map();

  private nextConnectionId = 1;
  private nextPreparedStatementId = 1;
  private nextStreamingResultId = 1;

  /**
   * Handle an incoming message from the main thread.
   */
  async onMessage(event: MessageEvent): Promise<void> {
    const request = event.data as WorkerRequest;
    const { messageId, type, data } = request;

    try {
      switch (type) {
        case WorkerRequestType.PING:
          this.postResponse(messageId, WorkerResponseType.OK, undefined);
          break;

        case WorkerRequestType.INSTANTIATE:
          await this.handleInstantiate(messageId, data as InstantiateRequest);
          break;

        case WorkerRequestType.GET_VERSION:
          this.handleGetVersion(messageId);
          break;

        case WorkerRequestType.OPEN:
          this.handleOpen(messageId, data as OpenRequest);
          break;

        case WorkerRequestType.CLOSE:
          this.handleClose(messageId);
          break;

        case WorkerRequestType.CONNECT:
          this.handleConnect(messageId);
          break;

        case WorkerRequestType.DISCONNECT:
          this.handleDisconnect(messageId, data as DisconnectRequest);
          break;

        case WorkerRequestType.QUERY:
          this.handleQuery(messageId, data as QueryRequest);
          break;

        case WorkerRequestType.QUERY_ARROW:
          this.handleQueryArrow(messageId, data as QueryArrowRequest);
          break;

        case WorkerRequestType.QUERY_STREAMING:
          this.handleQueryStreaming(messageId, data as QueryStreamingRequest);
          break;

        case WorkerRequestType.EXECUTE:
          this.handleExecute(messageId, data as ExecuteRequest);
          break;

        case WorkerRequestType.FETCH_CHUNK:
          this.handleFetchChunk(messageId, data as FetchChunkRequest);
          break;

        case WorkerRequestType.CLOSE_STREAMING_RESULT:
          this.handleCloseStreamingResult(messageId, data as CloseStreamingResultRequest);
          break;

        case WorkerRequestType.PREPARE:
          this.handlePrepare(messageId, data as PrepareRequest);
          break;

        case WorkerRequestType.RUN_PREPARED:
          this.handleRunPrepared(messageId, data as RunPreparedRequest);
          break;

        case WorkerRequestType.EXECUTE_PREPARED:
          this.handleExecutePrepared(messageId, data as ExecutePreparedRequest);
          break;

        case WorkerRequestType.CLOSE_PREPARED:
          this.handleClosePrepared(messageId, data as ClosePreparedRequest);
          break;

        case WorkerRequestType.BEGIN_TRANSACTION:
          this.handleBeginTransaction(messageId, data as TransactionRequest);
          break;

        case WorkerRequestType.COMMIT:
          this.handleCommit(messageId, data as TransactionRequest);
          break;

        case WorkerRequestType.ROLLBACK:
          this.handleRollback(messageId, data as TransactionRequest);
          break;

        case WorkerRequestType.REGISTER_FILE_URL:
          this.handleRegisterFileURL(messageId, data as RegisterFileURLRequest);
          break;

        case WorkerRequestType.REGISTER_FILE_BUFFER:
          this.handleRegisterFileBuffer(messageId, data as RegisterFileBufferRequest);
          break;

        case WorkerRequestType.REGISTER_FILE_TEXT:
          this.handleRegisterFileText(messageId, data as RegisterFileTextRequest);
          break;

        case WorkerRequestType.DROP_FILE:
          this.handleDropFile(messageId, data as DropFileRequest);
          break;

        case WorkerRequestType.DROP_FILES:
          this.handleDropFiles(messageId);
          break;

        case WorkerRequestType.FLUSH_FILES:
          this.handleFlushFiles(messageId);
          break;

        case WorkerRequestType.COPY_FILE_TO_BUFFER:
          this.handleCopyFileToBuffer(messageId, data as CopyFileToBufferRequest);
          break;

        case WorkerRequestType.COPY_FILE_TO_PATH:
          this.handleCopyFileToPath(messageId, data as CopyFileToPathRequest);
          break;

        case WorkerRequestType.GLOB_FILES:
          this.handleGlobFiles(messageId, data as GlobFilesRequest);
          break;

        case WorkerRequestType.INSERT_ARROW_FROM_IPC:
          this.handleInsertArrowFromIPC(messageId, data as InsertArrowFromIPCRequest);
          break;

        case WorkerRequestType.INSERT_CSV_FROM_PATH:
          this.handleInsertCSVFromPath(messageId, data as InsertCSVFromPathRequest);
          break;

        case WorkerRequestType.INSERT_JSON_FROM_PATH:
          this.handleInsertJSONFromPath(messageId, data as InsertJSONFromPathRequest);
          break;

        default:
          this.postError(messageId, `Unknown request type: ${type}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postError(messageId, message);
    }
  }

  // ============================================================================
  // Response helpers
  // ============================================================================

  private postResponse<T extends WorkerResponseType>(
    requestId: number,
    type: T,
    data: unknown,
    transfer?: Transferable[],
  ): void {
    const response: WorkerResponse<T> = {
      messageId: requestId, // Use requestId as messageId for simple correlation
      requestId,
      type,
      data,
    };
    if (transfer && transfer.length > 0) {
      self.postMessage(response, { transfer });
    } else {
      self.postMessage(response);
    }
  }

  private postError(requestId: number, message: string, code?: string, query?: string): void {
    const errorData: ErrorResponse = { message, code, query };
    this.postResponse(requestId, WorkerResponseType.ERROR, errorData);
  }

  private postOK(requestId: number): void {
    this.postResponse(requestId, WorkerResponseType.OK, undefined);
  }

  // ============================================================================
  // Module helpers
  // ============================================================================

  private getModule(): EmscriptenModule {
    if (!this.module) {
      throw new Error('DuckDB WASM module not initialized');
    }
    return this.module;
  }

  private getConnectionPtr(connectionId: number): number {
    const connPtr = this.connections.get(connectionId);
    if (!connPtr) {
      throw new Error(`Connection ${connectionId} not found`);
    }
    return connPtr;
  }

  // ============================================================================
  // Lifecycle handlers
  // ============================================================================

  private async handleInstantiate(
    requestId: number,
    data: InstantiateRequest,
  ): Promise<void> {
    // Type for the module factory function
    type ModuleFactory = (config?: Record<string, unknown>) => Promise<EmscriptenModule>;
    let DuckDBModule: ModuleFactory;

    // Check for pre-loaded module factory (for testing environments like @vitest/web-worker)
    if ((globalThis as unknown as { __DUCKDB_MODULE_FACTORY__?: ModuleFactory }).__DUCKDB_MODULE_FACTORY__) {
      DuckDBModule = (globalThis as unknown as { __DUCKDB_MODULE_FACTORY__: ModuleFactory }).__DUCKDB_MODULE_FACTORY__;
    } else {
      // Dynamic import of the Emscripten-generated JavaScript
      // wasmJsUrl must be provided for bundler compatibility
      if (!data.wasmJsUrl) {
        throw new Error('wasmJsUrl is required for initialization');
      }
      // Use Function constructor to create dynamic import that bundlers won't analyze
      const dynamicImport = new Function('url', 'return import(url)');
      DuckDBModule = (await dynamicImport(data.wasmJsUrl)).default;
    }

    // Initialize the Emscripten module
    const config: Record<string, unknown> = {};

    // Check for pre-compiled WASM module (for testing environments)
    const preloadedWasmModule = (globalThis as unknown as { __DUCKDB_WASM_MODULE__?: WebAssembly.Module }).__DUCKDB_WASM_MODULE__;
    if (preloadedWasmModule) {
      // Use Emscripten's instantiateWasm callback to provide pre-compiled module
      config.instantiateWasm = (
        imports: WebAssembly.Imports,
        successCallback: (instance: WebAssembly.Instance) => void,
      ) => {
        WebAssembly.instantiate(preloadedWasmModule, imports).then((instance) => {
          successCallback(instance);
        });
        return {}; // Return empty object; actual exports come via callback
      };
    } else if (data.wasmUrl) {
      config.locateFile = (path: string) => {
        if (path.endsWith('.wasm')) {
          return data.wasmUrl;
        }
        return path;
      };
    }

    this.module = (await DuckDBModule(config)) as EmscriptenModule;
    this.postOK(requestId);
  }

  private handleGetVersion(requestId: number): void {
    const mod = this.getModule();
    const versionPtr = mod.ccall('duckdb_library_version', 'number', [], []) as number;
    const version = mod.UTF8ToString(versionPtr);
    this.postResponse(requestId, WorkerResponseType.VERSION, { version });
  }

  private handleOpen(requestId: number, data?: OpenRequest): void {
    const mod = this.getModule();
    const config = data?.config ?? {};

    // Apply defaults
    const finalConfig = {
      accessMode: config.accessMode ?? AccessMode.AUTOMATIC,
      enableExternalAccess: config.enableExternalAccess ?? true,
      lockConfiguration: config.lockConfiguration ?? true,
      customConfig: config.customConfig ?? {},
    };

    // Create config object
    const configPtrPtr = mod._malloc(4);
    const createResult = mod.ccall(
      'duckdb_create_config',
      'number',
      ['number'],
      [configPtrPtr],
    ) as number;

    if (createResult !== 0) {
      mod._free(configPtrPtr);
      throw new Error('Failed to create DuckDB configuration');
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
          throw new Error(`Failed to set config option: ${name}`);
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
          throw new Error(`Failed to open database: ${errorMsg}`);
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
        this.executeSQLInternal('SET lock_configuration = true');
      }

      this.postOK(requestId);
    } finally {
      // Destroy config object
      const configPtrPtrForDestroy = mod._malloc(4);
      mod.setValue(configPtrPtrForDestroy, configPtr, 'i32');
      mod.ccall('duckdb_destroy_config', null, ['number'], [configPtrPtrForDestroy]);
      mod._free(configPtrPtrForDestroy);
    }
  }

  /**
   * Execute SQL without needing a connection ID (uses internal connection).
   * Used for internal operations like setting lock_configuration.
   */
  private executeSQLInternal(sql: string): void {
    const mod = this.getModule();

    // Create a temporary connection
    const connPtrPtr = mod._malloc(4);
    try {
      const connResult = mod.ccall(
        'duckdb_connect',
        'number',
        ['number', 'number'],
        [this.dbPtr, connPtrPtr],
      ) as number;

      if (connResult !== 0) {
        return; // Silently fail for internal operations
      }

      const connPtr = mod.getValue(connPtrPtr, 'i32');

      const resultPtr = mod._malloc(64);
      try {
        mod.ccall(
          'duckdb_query',
          'number',
          ['number', 'string', 'number'],
          [connPtr, sql, resultPtr],
        );
        mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
      } finally {
        mod._free(resultPtr);
      }

      mod.ccall('duckdb_disconnect', null, ['number'], [connPtrPtr]);
    } finally {
      mod._free(connPtrPtr);
    }
  }

  private handleClose(requestId: number): void {
    const mod = this.getModule();

    // Close all connections first
    for (const [, connPtr] of this.connections) {
      mod.ccall('duckdb_disconnect', null, ['number'], [connPtr]);
    }
    this.connections.clear();

    // Close all prepared statements
    for (const [, info] of this.preparedStatements) {
      // duckdb_destroy_prepare expects a pointer to the statement pointer
      const stmtPtrPtr = mod._malloc(4);
      try {
        mod.setValue(stmtPtrPtr, info.stmtPtr, 'i32');
        mod.ccall('duckdb_destroy_prepare', null, ['number'], [stmtPtrPtr]);
      } finally {
        mod._free(stmtPtrPtr);
      }
    }
    this.preparedStatements.clear();

    // Close all streaming results
    for (const [, info] of this.streamingResults) {
      mod.ccall('duckdb_destroy_result', null, ['number'], [info.resultPtr]);
    }
    this.streamingResults.clear();

    // Close database
    if (this.dbPtr) {
      const dbPtrPtr = mod._malloc(4);
      try {
        mod.setValue(dbPtrPtr, this.dbPtr, '*');
        mod.ccall('duckdb_close', null, ['number'], [dbPtrPtr]);
      } finally {
        mod._free(dbPtrPtr);
      }
      this.dbPtr = 0;
    }

    this.postOK(requestId);
  }

  private handleConnect(requestId: number): void {
    const mod = this.getModule();

    if (!this.dbPtr) {
      throw new Error('Database not opened');
    }

    const connPtrPtr = mod._malloc(4);
    try {
      const result = mod.ccall(
        'duckdb_connect',
        'number',
        ['number', 'number'],
        [this.dbPtr, connPtrPtr],
      ) as number;

      if (result !== 0) {
        throw new Error('Failed to create connection');
      }

      const connPtr = mod.getValue(connPtrPtr, '*');
      const connectionId = this.nextConnectionId++;
      this.connections.set(connectionId, connPtr);

      this.postResponse(requestId, WorkerResponseType.CONNECTION_ID, { connectionId });
    } finally {
      mod._free(connPtrPtr);
    }
  }

  private handleDisconnect(requestId: number, data: DisconnectRequest): void {
    const mod = this.getModule();
    const connPtr = this.getConnectionPtr(data.connectionId);

    mod.ccall('duckdb_disconnect', null, ['number'], [connPtr]);
    this.connections.delete(data.connectionId);

    this.postOK(requestId);
  }

  // ============================================================================
  // Query handlers
  // ============================================================================

  private handleQuery(requestId: number, data: QueryRequest): void {
    const mod = this.getModule();
    const connPtr = this.getConnectionPtr(data.connectionId);

    const resultPtr = mod._malloc(64);
    try {
      const status = mod.ccall(
        'duckdb_query',
        'number',
        ['number', 'string', 'number'],
        [connPtr, data.sql, resultPtr],
      ) as number;

      if (status !== 0) {
        const errorPtr = mod.ccall('duckdb_result_error', 'number', ['number'], [resultPtr]) as number;
        const error = errorPtr ? mod.UTF8ToString(errorPtr) : 'Query failed';
        mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new Error(error);
      }

      // Extract results
      const { columns, rows } = this.extractQueryResult(mod, resultPtr);
      mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);

      const response: QueryResultResponse = { columns, rows };
      this.postResponse(requestId, WorkerResponseType.QUERY_RESULT, response);
    } finally {
      mod._free(resultPtr);
    }
  }

  private handleQueryArrow(requestId: number, data: QueryArrowRequest): void {
    const mod = this.getModule();
    const connPtr = this.getConnectionPtr(data.connectionId);

    const resultPtr = mod._malloc(64);
    try {
      const status = mod.ccall(
        'duckdb_query',
        'number',
        ['number', 'string', 'number'],
        [connPtr, data.sql, resultPtr],
      ) as number;

      if (status !== 0) {
        const errorPtr = mod.ccall('duckdb_result_error', 'number', ['number'], [resultPtr]) as number;
        const error = errorPtr ? mod.UTF8ToString(errorPtr) : 'Query failed';
        mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new Error(error);
      }

      // Build Arrow table and serialize to IPC
      const table = this.buildArrowTable(mod, resultPtr);
      mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);

      const ipcBuffer = tableToIPC(table, { format: 'stream' });
      if (!ipcBuffer) {
        throw new Error('Failed to serialize Arrow table to IPC');
      }
      this.postResponse(
        requestId,
        WorkerResponseType.ARROW_IPC,
        { ipcBuffer },
        [ipcBuffer.buffer],
      );
    } finally {
      mod._free(resultPtr);
    }
  }

  private handleQueryStreaming(requestId: number, data: QueryStreamingRequest): void {
    const mod = this.getModule();
    const connPtr = this.getConnectionPtr(data.connectionId);

    const resultPtr = mod._malloc(64);
    try {
      const status = mod.ccall(
        'duckdb_query',
        'number',
        ['number', 'string', 'number'],
        [connPtr, data.sql, resultPtr],
      ) as number;

      if (status !== 0) {
        const errorPtr = mod.ccall('duckdb_result_error', 'number', ['number'], [resultPtr]) as number;
        const error = errorPtr ? mod.UTF8ToString(errorPtr) : 'Query failed';
        mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new Error(error);
      }

      // Get column metadata
      const columns = this.getColumnInfo(mod, resultPtr);

      // Store streaming result
      const streamingResultId = this.nextStreamingResultId++;
      this.streamingResults.set(streamingResultId, {
        resultPtr,
        connectionId: data.connectionId,
        columns,
        currentChunk: 0,
      });

      const response: StreamingResultInfoResponse = { streamingResultId, columns };
      this.postResponse(requestId, WorkerResponseType.STREAMING_RESULT_INFO, response);
    } catch (e) {
      mod._free(resultPtr);
      throw e;
    }
  }

  private handleExecute(requestId: number, data: ExecuteRequest): void {
    const mod = this.getModule();
    const connPtr = this.getConnectionPtr(data.connectionId);

    const resultPtr = mod._malloc(64);
    try {
      const status = mod.ccall(
        'duckdb_query',
        'number',
        ['number', 'string', 'number'],
        [connPtr, data.sql, resultPtr],
      ) as number;

      if (status !== 0) {
        const errorPtr = mod.ccall('duckdb_result_error', 'number', ['number'], [resultPtr]) as number;
        const error = errorPtr ? mod.UTF8ToString(errorPtr) : 'Query failed';
        mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new Error(error);
      }

      // Get rows changed
      const rowsChanged = mod.ccall(
        'duckdb_rows_changed',
        'number',
        ['number'],
        [resultPtr],
      ) as number;

      mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);

      this.postResponse(requestId, WorkerResponseType.ROWS_CHANGED, { rowsChanged });
    } finally {
      mod._free(resultPtr);
    }
  }

  private handleFetchChunk(requestId: number, data: FetchChunkRequest): void {
    const mod = this.getModule();
    const info = this.streamingResults.get(data.streamingResultId);

    if (!info) {
      throw new Error(`Streaming result ${data.streamingResultId} not found`);
    }

    // For DuckDB C API, results are materialized, so we simulate chunking
    // by reading rows in batches
    const CHUNK_SIZE = 2048;
    const rowCount = mod.ccall('duckdb_row_count', 'number', ['number'], [info.resultPtr]) as number;

    const startRow = info.currentChunk * CHUNK_SIZE;
    const endRow = Math.min(startRow + CHUNK_SIZE, rowCount);
    const chunkRowCount = endRow - startRow;
    const done = endRow >= rowCount;

    if (chunkRowCount === 0) {
      const response: DataChunkResponse = {
        columns: info.columns,
        rows: [],
        rowCount: 0,
        done: true,
      };
      this.postResponse(requestId, WorkerResponseType.DATA_CHUNK, response);
      return;
    }

    // Extract rows for this chunk
    const rows = this.extractRows(mod, info.resultPtr, info.columns, startRow, endRow);
    info.currentChunk++;

    const response: DataChunkResponse = {
      columns: info.columns,
      rows,
      rowCount: chunkRowCount,
      done,
    };
    this.postResponse(requestId, WorkerResponseType.DATA_CHUNK, response);
  }

  private handleCloseStreamingResult(requestId: number, data: CloseStreamingResultRequest): void {
    const mod = this.getModule();
    const info = this.streamingResults.get(data.streamingResultId);

    if (info) {
      mod.ccall('duckdb_destroy_result', null, ['number'], [info.resultPtr]);
      this.streamingResults.delete(data.streamingResultId);
    }

    this.postOK(requestId);
  }

  // ============================================================================
  // Prepared statement handlers
  // ============================================================================

  private handlePrepare(requestId: number, data: PrepareRequest): void {
    const mod = this.getModule();
    const connPtr = this.getConnectionPtr(data.connectionId);

    const stmtPtrPtr = mod._malloc(4);
    try {
      const result = mod.ccall(
        'duckdb_prepare',
        'number',
        ['number', 'string', 'number'],
        [connPtr, data.sql, stmtPtrPtr],
      ) as number;

      if (result !== 0) {
        // Get error from prepared statement
        const stmtPtr = mod.getValue(stmtPtrPtr, '*');
        if (stmtPtr) {
          const errorPtr = mod.ccall('duckdb_prepare_error', 'number', ['number'], [stmtPtr]) as number;
          const error = errorPtr ? mod.UTF8ToString(errorPtr) : 'Prepare failed';
          // duckdb_destroy_prepare expects a pointer to the statement pointer
          // stmtPtrPtr already contains the pointer, so we can use it directly
          mod.ccall('duckdb_destroy_prepare', null, ['number'], [stmtPtrPtr]);
          throw new Error(error);
        }
        throw new Error('Prepare failed');
      }

      const stmtPtr = mod.getValue(stmtPtrPtr, '*');
      const preparedStatementId = this.nextPreparedStatementId++;

      this.preparedStatements.set(preparedStatementId, {
        stmtPtr,
        connectionId: data.connectionId,
        sql: data.sql,
      });

      this.postResponse(requestId, WorkerResponseType.PREPARED_STATEMENT_ID, { preparedStatementId });
    } finally {
      mod._free(stmtPtrPtr);
    }
  }

  private handleRunPrepared(requestId: number, data: RunPreparedRequest): void {
    const mod = this.getModule();
    const info = this.preparedStatements.get(data.preparedStatementId);

    if (!info) {
      throw new Error(`Prepared statement ${data.preparedStatementId} not found`);
    }

    // Apply bindings
    this.applyBindings(mod, info.stmtPtr, data.bindings);

    // Execute
    const resultPtr = mod._malloc(64);
    try {
      const status = mod.ccall(
        'duckdb_execute_prepared',
        'number',
        ['number', 'number'],
        [info.stmtPtr, resultPtr],
      ) as number;

      if (status !== 0) {
        const errorPtr = mod.ccall('duckdb_result_error', 'number', ['number'], [resultPtr]) as number;
        const error = errorPtr ? mod.UTF8ToString(errorPtr) : 'Execute prepared failed';
        mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new Error(error);
      }

      const { columns, rows } = this.extractQueryResult(mod, resultPtr);
      mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);

      const response: QueryResultResponse = { columns, rows };
      this.postResponse(requestId, WorkerResponseType.QUERY_RESULT, response);
    } finally {
      mod._free(resultPtr);
    }
  }

  private handleExecutePrepared(requestId: number, data: ExecutePreparedRequest): void {
    const mod = this.getModule();
    const info = this.preparedStatements.get(data.preparedStatementId);

    if (!info) {
      throw new Error(`Prepared statement ${data.preparedStatementId} not found`);
    }

    // Apply bindings
    this.applyBindings(mod, info.stmtPtr, data.bindings);

    // Execute
    const resultPtr = mod._malloc(64);
    try {
      const status = mod.ccall(
        'duckdb_execute_prepared',
        'number',
        ['number', 'number'],
        [info.stmtPtr, resultPtr],
      ) as number;

      if (status !== 0) {
        const errorPtr = mod.ccall('duckdb_result_error', 'number', ['number'], [resultPtr]) as number;
        const error = errorPtr ? mod.UTF8ToString(errorPtr) : 'Execute prepared failed';
        mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new Error(error);
      }

      const rowsChanged = mod.ccall('duckdb_rows_changed', 'number', ['number'], [resultPtr]) as number;
      mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);

      this.postResponse(requestId, WorkerResponseType.ROWS_CHANGED, { rowsChanged });
    } finally {
      mod._free(resultPtr);
    }
  }

  private handleClosePrepared(requestId: number, data: ClosePreparedRequest): void {
    const mod = this.getModule();
    const info = this.preparedStatements.get(data.preparedStatementId);

    if (info) {
      // duckdb_destroy_prepare expects a pointer to the statement pointer
      const stmtPtrPtr = mod._malloc(4);
      try {
        mod.setValue(stmtPtrPtr, info.stmtPtr, 'i32');
        mod.ccall('duckdb_destroy_prepare', null, ['number'], [stmtPtrPtr]);
      } finally {
        mod._free(stmtPtrPtr);
      }
      this.preparedStatements.delete(data.preparedStatementId);
    }

    this.postOK(requestId);
  }

  private applyBindings(mod: EmscriptenModule, stmtPtr: number, bindings: PreparedStatementBinding[]): void {
    // Apply bindings directly using duckdb_bind_* functions
    for (const binding of bindings) {
      const { index, type, value } = binding;
      let result: number;

      switch (type) {
        case 'null':
          result = mod.ccall(
            'duckdb_bind_null',
            'number',
            ['number', 'number', 'number'],
            [stmtPtr, index, 0]
          ) as number;
          break;

        case 'boolean':
          result = mod.ccall(
            'duckdb_bind_boolean',
            'number',
            ['number', 'number', 'number', 'number'],
            [stmtPtr, index, 0, (value as boolean) ? 1 : 0]
          ) as number;
          break;

        case 'int8':
        case 'int16':
        case 'int32':
        case 'uint8':
        case 'uint16':
        case 'uint32':
          result = mod.ccall(
            'duckdb_bind_int32',
            'number',
            ['number', 'number', 'number', 'number'],
            [stmtPtr, index, 0, value as number]
          ) as number;
          break;

        case 'int64':
        case 'uint64': {
          const val = BigInt(value as bigint);
          const valLow = Number(val & BigInt(0xffffffff));
          const valHigh = Number((val >> BigInt(32)) & BigInt(0xffffffff));
          result = mod.ccall(
            'duckdb_bind_int64',
            'number',
            ['number', 'number', 'number', 'number', 'number'],
            [stmtPtr, index, 0, valLow, valHigh]
          ) as number;
          break;
        }

        case 'float':
          result = mod.ccall(
            'duckdb_bind_float',
            'number',
            ['number', 'number', 'number', 'number'],
            [stmtPtr, index, 0, value as number]
          ) as number;
          break;

        case 'double':
          result = mod.ccall(
            'duckdb_bind_double',
            'number',
            ['number', 'number', 'number', 'number'],
            [stmtPtr, index, 0, value as number]
          ) as number;
          break;

        case 'varchar':
          result = mod.ccall(
            'duckdb_bind_varchar',
            'number',
            ['number', 'number', 'number', 'string'],
            [stmtPtr, index, 0, value as string]
          ) as number;
          break;

        case 'blob': {
          const blob = value as Uint8Array;
          const ptr = mod._malloc(blob.length);
          try {
            mod.HEAPU8.set(blob, ptr);
            result = mod.ccall(
              'duckdb_bind_blob',
              'number',
              ['number', 'number', 'number', 'number', 'number', 'number'],
              [stmtPtr, index, 0, ptr, blob.length, 0]
            ) as number;
          } finally {
            mod._free(ptr);
          }
          break;
        }

        default:
          throw new Error(`Unsupported binding type: ${type}`);
      }

      if (result !== 0) {
        throw new Error(`Failed to bind ${type} at index ${index}`);
      }
    }
  }

  // ============================================================================
  // Transaction handlers
  // ============================================================================

  private handleBeginTransaction(requestId: number, data: TransactionRequest): void {
    this.executeSQL(data.connectionId, 'BEGIN TRANSACTION');
    this.postOK(requestId);
  }

  private handleCommit(requestId: number, data: TransactionRequest): void {
    this.executeSQL(data.connectionId, 'COMMIT');
    this.postOK(requestId);
  }

  private handleRollback(requestId: number, data: TransactionRequest): void {
    this.executeSQL(data.connectionId, 'ROLLBACK');
    this.postOK(requestId);
  }

  private executeSQL(connectionId: number, sql: string): void {
    const mod = this.getModule();
    const connPtr = this.getConnectionPtr(connectionId);

    const resultPtr = mod._malloc(64);
    try {
      const status = mod.ccall(
        'duckdb_query',
        'number',
        ['number', 'string', 'number'],
        [connPtr, sql, resultPtr],
      ) as number;

      if (status !== 0) {
        const errorPtr = mod.ccall('duckdb_result_error', 'number', ['number'], [resultPtr]) as number;
        const error = errorPtr ? mod.UTF8ToString(errorPtr) : 'Query failed';
        mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
        throw new Error(error);
      }

      mod.ccall('duckdb_destroy_result', null, ['number'], [resultPtr]);
    } finally {
      mod._free(resultPtr);
    }
  }

  // ============================================================================
  // File registration handlers
  // ============================================================================

  private handleRegisterFileURL(requestId: number, _data: RegisterFileURLRequest): void {
    // httpfs extension handles URLs automatically via SQL
    // No explicit registration needed - URLs work directly in queries
    this.postOK(requestId);
  }

  private handleRegisterFileBuffer(requestId: number, data: RegisterFileBufferRequest): void {
    const mod = this.getModule();

    // Write buffer to Emscripten filesystem
    const path = `/${data.name}`;

    // Create directories if needed
    const parts = path.split('/').filter(Boolean);
    let currentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += '/' + parts[i];
      try {
        (mod as unknown as { FS: { mkdir: (path: string) => void } }).FS.mkdir(currentPath);
      } catch {
        // Directory might already exist
      }
    }

    // Write file
    (mod as unknown as { FS: { writeFile: (path: string, data: Uint8Array) => void } }).FS.writeFile(path, data.buffer);

    this.postOK(requestId);
  }

  private handleRegisterFileText(requestId: number, data: RegisterFileTextRequest): void {
    const mod = this.getModule();

    // Convert text to buffer and write to Emscripten filesystem
    const path = `/${data.name}`;
    const encoder = new TextEncoder();
    const buffer = encoder.encode(data.text);

    (mod as unknown as { FS: { writeFile: (path: string, data: Uint8Array) => void } }).FS.writeFile(path, buffer);

    this.postOK(requestId);
  }

  private handleDropFile(requestId: number, data: DropFileRequest): void {
    const mod = this.getModule();

    try {
      const path = `/${data.name}`;
      (mod as unknown as { FS: { unlink: (path: string) => void } }).FS.unlink(path);
    } catch {
      // File might not exist
    }

    this.postOK(requestId);
  }

  private handleDropFiles(requestId: number): void {
    // This would need to track all registered files - for now just acknowledge
    this.postOK(requestId);
  }

  private handleFlushFiles(requestId: number): void {
    // Emscripten FS doesn't need explicit flushing in memory mode
    this.postOK(requestId);
  }

  private handleCopyFileToBuffer(requestId: number, data: CopyFileToBufferRequest): void {
    const mod = this.getModule();

    const path = `/${data.name}`;
    const buffer = (mod as unknown as { FS: { readFile: (path: string) => Uint8Array } }).FS.readFile(path);

    this.postResponse(requestId, WorkerResponseType.FILE_BUFFER, { buffer }, [buffer.buffer]);
  }

  private handleCopyFileToPath(requestId: number, data: CopyFileToPathRequest): void {
    const mod = this.getModule();

    const srcPath = `/${data.srcName}`;
    const dstPath = `/${data.dstPath}`;

    const buffer = (mod as unknown as { FS: { readFile: (path: string) => Uint8Array } }).FS.readFile(srcPath);
    (mod as unknown as { FS: { writeFile: (path: string, data: Uint8Array) => void } }).FS.writeFile(dstPath, buffer);

    this.postOK(requestId);
  }

  private handleGlobFiles(requestId: number, data: GlobFilesRequest): void {
    const mod = this.getModule();

    // Simple glob implementation - list directory and filter
    const files: { name: string; size: number }[] = [];

    try {
      const dir = (mod as unknown as { FS: { readdir: (path: string) => string[] } }).FS.readdir('/');
      const pattern = data.pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
      const regex = new RegExp(`^${pattern}$`);

      for (const name of dir) {
        if (name === '.' || name === '..') continue;
        if (regex.test(name)) {
          try {
            const stat = (mod as unknown as { FS: { stat: (path: string) => { size: number } } }).FS.stat(`/${name}`);
            files.push({ name, size: stat.size });
          } catch {
            // Skip files that can't be stat'd
          }
        }
      }
    } catch {
      // Directory might not exist
    }

    this.postResponse(requestId, WorkerResponseType.FILE_INFO_LIST, { files });
  }

  // ============================================================================
  // Data insertion handlers
  // ============================================================================

  private handleInsertArrowFromIPC(requestId: number, data: InsertArrowFromIPCRequest): void {
    // For now, write IPC to temp file and use COPY
    // A more efficient implementation would use the Arrow API directly
    const mod = this.getModule();
    const tempPath = `/_temp_arrow_${Date.now()}.arrow`;

    (mod as unknown as { FS: { writeFile: (path: string, data: Uint8Array) => void } }).FS.writeFile(tempPath, data.ipcBuffer);

    try {
      this.executeSQL(
        data.connectionId,
        `CREATE TABLE IF NOT EXISTS "${data.tableName}" AS SELECT * FROM '${tempPath}'`,
      );
    } finally {
      try {
        (mod as unknown as { FS: { unlink: (path: string) => void } }).FS.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    this.postOK(requestId);
  }

  private handleInsertCSVFromPath(requestId: number, data: InsertCSVFromPathRequest): void {
    let sql = `CREATE TABLE IF NOT EXISTS "${data.tableName}" AS SELECT * FROM read_csv('/${data.path}'`;

    if (data.options) {
      const opts: string[] = [];
      if (data.options.header !== undefined) opts.push(`header = ${data.options.header}`);
      if (data.options.delimiter) opts.push(`delim = '${data.options.delimiter}'`);
      if (data.options.quote) opts.push(`quote = '${data.options.quote}'`);
      if (data.options.escape) opts.push(`escape = '${data.options.escape}'`);
      if (data.options.skip) opts.push(`skip = ${data.options.skip}`);
      if (opts.length > 0) {
        sql += `, ${opts.join(', ')}`;
      }
    }

    sql += ')';

    this.executeSQL(data.connectionId, sql);
    this.postOK(requestId);
  }

  private handleInsertJSONFromPath(requestId: number, data: InsertJSONFromPathRequest): void {
    let sql = `CREATE TABLE IF NOT EXISTS "${data.tableName}" AS SELECT * FROM read_json('/${data.path}'`;

    if (data.options) {
      const opts: string[] = [];
      if (data.options.format) opts.push(`format = '${data.options.format}'`);
      if (opts.length > 0) {
        sql += `, ${opts.join(', ')}`;
      }
    }

    sql += ')';

    this.executeSQL(data.connectionId, sql);
    this.postOK(requestId);
  }

  // ============================================================================
  // Result extraction helpers
  // ============================================================================

  private getColumnInfo(mod: EmscriptenModule, resultPtr: number): ColumnInfo[] {
    const columnCount = mod.ccall('duckdb_column_count', 'number', ['number'], [resultPtr]) as number;

    const columns: ColumnInfo[] = [];
    for (let i = 0; i < columnCount; i++) {
      const namePtr = mod.ccall('duckdb_column_name', 'number', ['number', 'number'], [resultPtr, i]) as number;
      const type = mod.ccall('duckdb_column_type', 'number', ['number', 'number'], [resultPtr, i]) as number;

      columns.push({
        name: mod.UTF8ToString(namePtr),
        type: type as DuckDBTypeId,
      });
    }

    return columns;
  }

  private extractQueryResult(mod: EmscriptenModule, resultPtr: number): { columns: ColumnInfo[]; rows: unknown[][] } {
    const columns = this.getColumnInfo(mod, resultPtr);
    const rowCount = mod.ccall('duckdb_row_count', 'number', ['number'], [resultPtr]) as number;
    const rows = this.extractRows(mod, resultPtr, columns, 0, rowCount);
    return { columns, rows };
  }

  private extractRows(
    mod: EmscriptenModule,
    resultPtr: number,
    columns: ColumnInfo[],
    startRow: number,
    endRow: number,
  ): unknown[][] {
    const rows: unknown[][] = [];
    const columnCount = columns.length;

    for (let rowIdx = startRow; rowIdx < endRow; rowIdx++) {
      const row: unknown[] = [];
      for (let colIdx = 0; colIdx < columnCount; colIdx++) {
        const col = columns[colIdx];

        // Check for null
        const isNull = mod.ccall(
          'duckdb_value_is_null',
          'number',
          ['number', 'number', 'number', 'number', 'number'],
          [resultPtr, colIdx, 0, rowIdx, 0],
        ) as number;

        if (isNull) {
          row.push(null);
        } else {
          row.push(this.extractValue(mod, resultPtr, colIdx, rowIdx, col.type));
        }
      }
      rows.push(row);
    }

    return rows;
  }

  private extractValue(
    mod: EmscriptenModule,
    resultPtr: number,
    colIdx: number,
    rowIdx: number,
    type: DuckDBTypeId,
  ): unknown {
    // idx_t parameters need to be passed as two i32 values (low, high)
    switch (type) {
      case DuckDBType.BOOLEAN: {
        const val = mod.ccall(
          'duckdb_value_boolean',
          'number',
          ['number', 'number', 'number', 'number', 'number'],
          [resultPtr, colIdx, 0, rowIdx, 0],
        ) as number;
        return val !== 0;
      }
      case DuckDBType.TINYINT:
        return mod.ccall('duckdb_value_int8', 'number', ['number', 'number', 'number', 'number', 'number'], [resultPtr, colIdx, 0, rowIdx, 0]) as number;
      case DuckDBType.SMALLINT:
        return mod.ccall('duckdb_value_int16', 'number', ['number', 'number', 'number', 'number', 'number'], [resultPtr, colIdx, 0, rowIdx, 0]) as number;
      case DuckDBType.INTEGER:
        return mod.ccall('duckdb_value_int32', 'number', ['number', 'number', 'number', 'number', 'number'], [resultPtr, colIdx, 0, rowIdx, 0]) as number;
      case DuckDBType.BIGINT: {
        // Return as number if within safe integer range, otherwise as string for JSON compatibility
        const strPtr = mod.ccall('duckdb_value_varchar', 'number', ['number', 'number', 'number', 'number', 'number'], [resultPtr, colIdx, 0, rowIdx, 0]) as number;
        if (strPtr) {
          const val = mod.UTF8ToString(strPtr);
          mod._free(strPtr);
          const num = Number(val);
          // Return as number if it fits safely, otherwise keep as string
          return Number.isSafeInteger(num) ? num : val;
        }
        return null;
      }
      case DuckDBType.UTINYINT:
        return mod.ccall('duckdb_value_uint8', 'number', ['number', 'number', 'number', 'number', 'number'], [resultPtr, colIdx, 0, rowIdx, 0]) as number;
      case DuckDBType.USMALLINT:
        return mod.ccall('duckdb_value_uint16', 'number', ['number', 'number', 'number', 'number', 'number'], [resultPtr, colIdx, 0, rowIdx, 0]) as number;
      case DuckDBType.UINTEGER: {
        // Convert signed i32 to unsigned using >>> 0
        const signed = mod.ccall('duckdb_value_uint32', 'number', ['number', 'number', 'number', 'number', 'number'], [resultPtr, colIdx, 0, rowIdx, 0]) as number;
        return signed >>> 0;
      }
      case DuckDBType.UBIGINT: {
        // Return as number if within safe integer range, otherwise as string for JSON compatibility
        const strPtr = mod.ccall('duckdb_value_varchar', 'number', ['number', 'number', 'number', 'number', 'number'], [resultPtr, colIdx, 0, rowIdx, 0]) as number;
        if (strPtr) {
          const val = mod.UTF8ToString(strPtr);
          mod._free(strPtr);
          const num = Number(val);
          // Return as number if it fits safely, otherwise keep as string
          return Number.isSafeInteger(num) ? num : val;
        }
        return null;
      }
      case DuckDBType.FLOAT:
        return mod.ccall('duckdb_value_float', 'number', ['number', 'number', 'number', 'number', 'number'], [resultPtr, colIdx, 0, rowIdx, 0]) as number;
      case DuckDBType.DOUBLE:
        return mod.ccall('duckdb_value_double', 'number', ['number', 'number', 'number', 'number', 'number'], [resultPtr, colIdx, 0, rowIdx, 0]) as number;
      default: {
        // Fallback to varchar for all other types
        const strPtr = mod.ccall('duckdb_value_varchar', 'number', ['number', 'number', 'number', 'number', 'number'], [resultPtr, colIdx, 0, rowIdx, 0]) as number;
        if (strPtr) {
          const val = mod.UTF8ToString(strPtr);
          mod._free(strPtr);
          return val;
        }
        return null;
      }
    }
  }

  private buildArrowTable(mod: EmscriptenModule, resultPtr: number): ReturnType<typeof tableFromArrays> {
    const columns = this.getColumnInfo(mod, resultPtr);
    const rowCount = mod.ccall('duckdb_row_count', 'number', ['number'], [resultPtr]) as number;
    const columnCount = columns.length;

    const columnArrays: Record<string, { type: DataType; values: unknown[] }> = {};

    for (let colIdx = 0; colIdx < columnCount; colIdx++) {
      const col = columns[colIdx];
      const flechetteType = this.getFlechetteType(col.type);
      const values: unknown[] = [];

      for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
        const isNull = mod.ccall(
          'duckdb_value_is_null',
          'number',
          ['number', 'number', 'number', 'number', 'number'],
          [resultPtr, colIdx, 0, rowIdx, 0],
        ) as number;

        if (isNull) {
          values.push(null);
        } else {
          values.push(this.extractValue(mod, resultPtr, colIdx, rowIdx, col.type));
        }
      }

      columnArrays[col.name] = { type: flechetteType, values };
    }

    // Build arrays for tableFromArrays
    const arrays: Record<string, unknown[]> = {};
    for (const [name, { values }] of Object.entries(columnArrays)) {
      arrays[name] = values;
    }

    return tableFromArrays(arrays);
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
        return utf8(); // Fallback to string
    }
  }
}
