import { describe, expect, it } from 'vitest';
import { DuckDB } from './testDb';
import { ducklingsWorkerPlugin, getWasmPath } from '../dist/vite-plugin.js';
import { fileURLToPath } from 'node:url';

describe('Iceberg package isolation', () => {
  it('bundles httpfs, Parquet, Avro, and Iceberg', async () => {
    const db = new DuckDB();
    const conn = db.connect();
    try {
      const extensions = (await conn.query('SELECT extension_name FROM duckdb_extensions() WHERE loaded'))
        .map((row: { extension_name: string }) => row.extension_name);
      for (const name of ['httpfs', 'parquet', 'avro', 'iceberg']) expect(extensions).toContain(name);
      for (const name of ['ducklake', 'spatial', 'json']) expect(extensions).not.toContain(name);
      const functions = await conn.query(
        "SELECT DISTINCT function_name FROM duckdb_functions() WHERE function_name IN ('read_avro', 'iceberg_scan') ORDER BY function_name",
      );
      expect(functions).toEqual([{ function_name: 'iceberg_scan' }, { function_name: 'read_avro' }]);
    } finally {
      conn.close();
      db.close();
    }
  });

  it('resolves only the Iceberg WASM import and emits a distinct filename', () => {
    const plugin = ducklingsWorkerPlugin();
    expect(plugin.resolveId?.('@ducklings/workers-iceberg/wasm')).toEqual({ id: './duckdb-workers-iceberg.wasm', external: true });
    for (const name of ['workers', 'workers-ducklake', 'workers-spatial']) {
      expect(plugin.resolveId?.(`@ducklings/${name}/wasm`)).toBeNull();
    }
    expect(getWasmPath()).toBe(fileURLToPath(new URL('../dist/wasm/duckdb-workers.wasm', import.meta.url)));
  });
});
