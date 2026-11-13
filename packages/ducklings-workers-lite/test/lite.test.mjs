import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { DuckDB, init } from '../dist/index.js';

const wasmModule = await WebAssembly.compile(
  await readFile(new URL('../dist/wasm/duckdb.wasm', import.meta.url)),
);

test('lite build answers a query', async () => {
  await init({ wasmModule });
  const db = new DuckDB();
  const conn = db.connect();

  const rows = await conn.query('SELECT 42 AS answer');
  assert.deepEqual(rows, [{ answer: 42 }]);

  const text = await conn.query(
    `SELECT
       'short' AS a,
       'a string long enough to live on the heap' AS b,
       'héllo' AS c,
       NULL::VARCHAR AS d,
       '\\xDE\\xAD'::BLOB AS e`,
  );
  assert.deepEqual(text, [
    {
      a: 'short',
      b: 'a string long enough to live on the heap',
      c: 'héllo',
      d: null,
      e: '\\xDE\\xAD',
    },
  ]);

  conn.close();
  db.close();
});
