/**
 * Shared test database instance.
 * All tests import from this module to ensure WASM is initialized.
 *
 * Web Worker polyfill is configured in test/setup.ts
 * The dispatcher checks globalThis for pre-loaded modules to avoid dynamic imports.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load WASM module and JS module factory before importing duckdb
const wasmPath = join(__dirname, '../dist/wasm/duckdb.wasm');
const wasmBuffer = await readFile(wasmPath);
const wasmModule = await WebAssembly.compile(wasmBuffer);

// Load the Emscripten module factory using pathToFileURL for proper URL formatting
const wasmJsPath = join(__dirname, '../dist/wasm/duckdb.js');
const wasmJsUrl = pathToFileURL(wasmJsPath).href;
const wasmJsModule = await import(wasmJsUrl);
const moduleFactory = wasmJsModule.default;

// Set pre-loaded modules on globalThis so the worker dispatcher can use them
// This avoids the need for dynamic imports inside the web-worker polyfill
(globalThis as unknown as { __DUCKDB_WASM_MODULE__: WebAssembly.Module }).__DUCKDB_WASM_MODULE__ = wasmModule;
(globalThis as unknown as { __DUCKDB_MODULE_FACTORY__: unknown }).__DUCKDB_MODULE_FACTORY__ = moduleFactory;

// Dynamic import from dist
const duckdb = await import('../dist/index.js');

// Get absolute URL for worker file
const workerPath = join(__dirname, '../dist/worker.js');
const workerUrl = pathToFileURL(workerPath).href;

// Initialize - the dispatcher will use globalThis modules instead of dynamic import
await duckdb.init({
  wasmModule,
  workerUrl,
});

// Re-export everything from the module
export const DuckDB = duckdb.DuckDB;
export const version = duckdb.version;
export const init = duckdb.init;
export const getDB = duckdb.getDB;
export const DuckDBError = duckdb.DuckDBError;
export const DuckDBType = duckdb.DuckDBType;

// Export types (these need to come from TypeScript source for proper type inference)
export type { DuckDBTypeId, ColumnInfo, InitOptions } from '../src/index';
