/**
 * Shared test database instance.
 * All tests import from this module to ensure WASM is initialized.
 */
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamic import of the ESM dist module
const distPath = join(__dirname, '../dist/index.js');
const duckdb = await import(distPath);

// Try dist first, then src (for development)
const distWasmPath = join(__dirname, '../dist/wasm/duckdb-workers.wasm');
const srcWasmPath = join(__dirname, '../src/wasm/duckdb-workers.wasm');

let wasmPath = distWasmPath;
try {
  await access(distWasmPath);
} catch {
  wasmPath = srcWasmPath;
}

const wasmBuffer = await readFile(wasmPath);
const wasmModule = await WebAssembly.compile(wasmBuffer);

await duckdb.init({ wasmModule });

// Re-export everything from the module
export const DuckDB = duckdb.DuckDB;
export const version = duckdb.version;
export const init = duckdb.init;
export const DuckDBError = duckdb.DuckDBError;
export const DuckDBType = duckdb.DuckDBType;

// Export types
export type { DuckDBTypeId, ColumnInfo, InitOptions } from '../src/index';
