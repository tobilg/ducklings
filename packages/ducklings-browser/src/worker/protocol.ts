/**
 * Worker message protocol for Ducklings
 * @packageDocumentation
 */

import type { ColumnInfo, CSVInsertOptions, JSONInsertOptions } from '../types.js';

/**
 * Request types sent from main thread to worker.
 */
export enum WorkerRequestType {
  // Lifecycle
  PING = 'PING',
  INSTANTIATE = 'INSTANTIATE',
  GET_VERSION = 'GET_VERSION',
  OPEN = 'OPEN',
  CLOSE = 'CLOSE',
  CONNECT = 'CONNECT',
  DISCONNECT = 'DISCONNECT',

  // Query operations
  QUERY = 'QUERY',
  QUERY_ARROW = 'QUERY_ARROW',
  QUERY_STREAMING = 'QUERY_STREAMING',
  EXECUTE = 'EXECUTE',
  FETCH_CHUNK = 'FETCH_CHUNK',
  CLOSE_STREAMING_RESULT = 'CLOSE_STREAMING_RESULT',
  RESET_STREAMING_RESULT = 'RESET_STREAMING_RESULT',

  // Prepared statements
  PREPARE = 'PREPARE',
  RUN_PREPARED = 'RUN_PREPARED',
  EXECUTE_PREPARED = 'EXECUTE_PREPARED',
  CLOSE_PREPARED = 'CLOSE_PREPARED',

  // Transactions
  BEGIN_TRANSACTION = 'BEGIN_TRANSACTION',
  COMMIT = 'COMMIT',
  ROLLBACK = 'ROLLBACK',

  // File registration
  REGISTER_FILE_URL = 'REGISTER_FILE_URL',
  REGISTER_FILE_BUFFER = 'REGISTER_FILE_BUFFER',
  REGISTER_FILE_HANDLE = 'REGISTER_FILE_HANDLE',
  REGISTER_FILE_TEXT = 'REGISTER_FILE_TEXT',

  // File operations
  DROP_FILE = 'DROP_FILE',
  DROP_FILES = 'DROP_FILES',
  FLUSH_FILES = 'FLUSH_FILES',
  COPY_FILE_TO_BUFFER = 'COPY_FILE_TO_BUFFER',
  COPY_FILE_TO_PATH = 'COPY_FILE_TO_PATH',
  GLOB_FILES = 'GLOB_FILES',

  // Data insertion
  INSERT_ARROW_FROM_IPC = 'INSERT_ARROW_FROM_IPC',
  INSERT_CSV_FROM_PATH = 'INSERT_CSV_FROM_PATH',
  INSERT_JSON_FROM_PATH = 'INSERT_JSON_FROM_PATH',
}

/**
 * Response types sent from worker to main thread.
 */
export enum WorkerResponseType {
  OK = 'OK',
  ERROR = 'ERROR',
  VERSION = 'VERSION',
  CONNECTION_ID = 'CONNECTION_ID',
  QUERY_RESULT = 'QUERY_RESULT',
  ARROW_IPC = 'ARROW_IPC',
  STREAMING_RESULT_INFO = 'STREAMING_RESULT_INFO',
  DATA_CHUNK = 'DATA_CHUNK',
  ROWS_CHANGED = 'ROWS_CHANGED',
  PREPARED_STATEMENT_ID = 'PREPARED_STATEMENT_ID',
  FILE_BUFFER = 'FILE_BUFFER',
  FILE_INFO_LIST = 'FILE_INFO_LIST',
}

// ============================================================================
// Request payload types
// ============================================================================

export interface InstantiateRequest {
  wasmUrl?: string;
  wasmJsUrl?: string;
}

export interface QueryRequest {
  connectionId: number;
  sql: string;
}

export interface QueryArrowRequest {
  connectionId: number;
  sql: string;
}

export interface QueryStreamingRequest {
  connectionId: number;
  sql: string;
}

export interface ExecuteRequest {
  connectionId: number;
  sql: string;
}

export interface FetchChunkRequest {
  connectionId: number;
  streamingResultId: number;
}

export interface CloseStreamingResultRequest {
  connectionId: number;
  streamingResultId: number;
}

export interface ResetStreamingResultRequest {
  connectionId: number;
  streamingResultId: number;
}

export interface PrepareRequest {
  connectionId: number;
  sql: string;
}

export interface RunPreparedRequest {
  connectionId: number;
  preparedStatementId: number;
  bindings: PreparedStatementBinding[];
}

export interface ExecutePreparedRequest {
  connectionId: number;
  preparedStatementId: number;
  bindings: PreparedStatementBinding[];
}

export interface ClosePreparedRequest {
  connectionId: number;
  preparedStatementId: number;
}

export interface TransactionRequest {
  connectionId: number;
}

export interface RegisterFileURLRequest {
  name: string;
  url: string;
  protocol?: string;
  directIO?: boolean;
}

export interface RegisterFileBufferRequest {
  name: string;
  buffer: Uint8Array;
}

export interface RegisterFileHandleRequest {
  name: string;
  handle: FileSystemFileHandle;
  protocol?: string;
  directIO?: boolean;
}

export interface RegisterFileTextRequest {
  name: string;
  text: string;
}

export interface DropFileRequest {
  name: string;
}

export interface CopyFileToBufferRequest {
  name: string;
}

export interface CopyFileToPathRequest {
  srcName: string;
  dstPath: string;
}

export interface GlobFilesRequest {
  pattern: string;
}

export interface InsertArrowFromIPCRequest {
  connectionId: number;
  tableName: string;
  ipcBuffer: Uint8Array;
}

export interface InsertCSVFromPathRequest {
  connectionId: number;
  tableName: string;
  path: string;
  options?: CSVInsertOptions;
}

export interface InsertJSONFromPathRequest {
  connectionId: number;
  tableName: string;
  path: string;
  options?: JSONInsertOptions;
}

export interface DisconnectRequest {
  connectionId: number;
}

// ============================================================================
// Response payload types
// ============================================================================

export interface ErrorResponse {
  message: string;
  code?: string;
  query?: string;
}

export interface VersionResponse {
  version: string;
}

export interface ConnectionIdResponse {
  connectionId: number;
}

export interface QueryResultResponse {
  columns: ColumnInfo[];
  rows: unknown[][];
}

export interface ArrowIPCResponse {
  ipcBuffer: Uint8Array;
}

export interface StreamingResultInfoResponse {
  streamingResultId: number;
  columns: ColumnInfo[];
}

export interface DataChunkResponse {
  columns: ColumnInfo[];
  rows: unknown[][];
  rowCount: number;
  done: boolean;
}

export interface RowsChangedResponse {
  rowsChanged: number;
}

export interface PreparedStatementIdResponse {
  preparedStatementId: number;
}

export interface FileBufferResponse {
  buffer: Uint8Array;
}

export interface FileInfoListResponse {
  files: { name: string; size: number }[];
}

// ============================================================================
// Prepared statement binding
// ============================================================================

export type PreparedStatementBindingType =
  | 'null'
  | 'boolean'
  | 'int8'
  | 'int16'
  | 'int32'
  | 'int64'
  | 'uint8'
  | 'uint16'
  | 'uint32'
  | 'uint64'
  | 'float'
  | 'double'
  | 'varchar'
  | 'blob'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'interval';

export interface PreparedStatementBinding {
  index: number;
  type: PreparedStatementBindingType;
  value: unknown;
}

// ============================================================================
// Message wrappers
// ============================================================================

/**
 * Base request message from main thread to worker.
 */
export interface WorkerRequest<T extends WorkerRequestType = WorkerRequestType, D = unknown> {
  messageId: number;
  type: T;
  data: D;
}

/**
 * Base response message from worker to main thread.
 */
export interface WorkerResponse<T extends WorkerResponseType = WorkerResponseType, D = unknown> {
  messageId: number;
  requestId: number;
  type: T;
  data: D;
}

// ============================================================================
// Worker task for tracking pending requests
// ============================================================================

/**
 * Represents a pending request to the worker.
 * @internal
 */
export class WorkerTask<T = unknown> {
  readonly messageId: number;
  readonly type: WorkerRequestType;
  private _resolve: (value: T) => void;
  private _reject: (error: Error) => void;
  readonly promise: Promise<T>;

  constructor(messageId: number, type: WorkerRequestType) {
    this.messageId = messageId;
    this.type = type;
    this._resolve = () => {};
    this._reject = () => {};
    this.promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  /**
   * Resolve the task with a successful result.
   */
  resolve(value: T): void {
    this._resolve(value);
  }

  /**
   * Reject the task with an error.
   */
  reject(error: Error): void {
    this._reject(error);
  }
}

// ============================================================================
// Type-safe request/response mapping
// ============================================================================

/**
 * Maps request types to their payload types.
 */
export type RequestPayloadMap = {
  [WorkerRequestType.PING]: undefined;
  [WorkerRequestType.INSTANTIATE]: InstantiateRequest;
  [WorkerRequestType.GET_VERSION]: undefined;
  [WorkerRequestType.OPEN]: undefined;
  [WorkerRequestType.CLOSE]: undefined;
  [WorkerRequestType.CONNECT]: undefined;
  [WorkerRequestType.DISCONNECT]: DisconnectRequest;
  [WorkerRequestType.QUERY]: QueryRequest;
  [WorkerRequestType.QUERY_ARROW]: QueryArrowRequest;
  [WorkerRequestType.QUERY_STREAMING]: QueryStreamingRequest;
  [WorkerRequestType.EXECUTE]: ExecuteRequest;
  [WorkerRequestType.FETCH_CHUNK]: FetchChunkRequest;
  [WorkerRequestType.CLOSE_STREAMING_RESULT]: CloseStreamingResultRequest;
  [WorkerRequestType.RESET_STREAMING_RESULT]: ResetStreamingResultRequest;
  [WorkerRequestType.PREPARE]: PrepareRequest;
  [WorkerRequestType.RUN_PREPARED]: RunPreparedRequest;
  [WorkerRequestType.EXECUTE_PREPARED]: ExecutePreparedRequest;
  [WorkerRequestType.CLOSE_PREPARED]: ClosePreparedRequest;
  [WorkerRequestType.BEGIN_TRANSACTION]: TransactionRequest;
  [WorkerRequestType.COMMIT]: TransactionRequest;
  [WorkerRequestType.ROLLBACK]: TransactionRequest;
  [WorkerRequestType.REGISTER_FILE_URL]: RegisterFileURLRequest;
  [WorkerRequestType.REGISTER_FILE_BUFFER]: RegisterFileBufferRequest;
  [WorkerRequestType.REGISTER_FILE_HANDLE]: RegisterFileHandleRequest;
  [WorkerRequestType.REGISTER_FILE_TEXT]: RegisterFileTextRequest;
  [WorkerRequestType.DROP_FILE]: DropFileRequest;
  [WorkerRequestType.DROP_FILES]: undefined;
  [WorkerRequestType.FLUSH_FILES]: undefined;
  [WorkerRequestType.COPY_FILE_TO_BUFFER]: CopyFileToBufferRequest;
  [WorkerRequestType.COPY_FILE_TO_PATH]: CopyFileToPathRequest;
  [WorkerRequestType.GLOB_FILES]: GlobFilesRequest;
  [WorkerRequestType.INSERT_ARROW_FROM_IPC]: InsertArrowFromIPCRequest;
  [WorkerRequestType.INSERT_CSV_FROM_PATH]: InsertCSVFromPathRequest;
  [WorkerRequestType.INSERT_JSON_FROM_PATH]: InsertJSONFromPathRequest;
};
