import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ducklingsWorkerPlugin, getWasmPath } from '@ducklings/workers/vite-plugin';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('default plugin resolves only its own WASM import', () => {
  assert.equal(manifest.name, '@ducklings/workers');
  assert.equal(getWasmPath(), fileURLToPath(import.meta.resolve('@ducklings/workers/wasm')));
  const plugin = ducklingsWorkerPlugin({ wasmFileName: 'custom.wasm' });
  assert.deepEqual(plugin.resolveId('@ducklings/workers/wasm'), { id: './custom.wasm', external: true });
  assert.equal(plugin.resolveId('@ducklings/workers-iceberg/wasm'), null);
  assert.equal(plugin.resolveId('@ducklings/workers-spatial/wasm'), null);
  assert.equal(plugin.resolveId('@ducklings/workers-ducklake/wasm'), null);
});

for (const format of ['esm', 'cjs']) {
  test(`default package ${format} export preserves DuckDB version and bundled extensions`, async () => {
    const api = format === 'esm' ? await import('@ducklings/workers') : require('@ducklings/workers');
    const wasmModule = await WebAssembly.compile(await readFile(getWasmPath()));
    let parquetBytes;
    const requests = [];
    await api.init({
      wasmModule,
      httpFetch: async (url, options) => {
        assert.equal(url, 'https://fixture.test/data.parquet');
        requests.push(options.method);
        await Promise.resolve();
        const headers = new Headers({
          'Content-Length': String(parquetBytes.byteLength),
          'Accept-Ranges': 'bytes',
        });
        if (options.method === 'HEAD') return new Response(null, { headers });
        const range = new Headers(options.headers).get('Range')?.match(/^bytes=(\d+)-(\d*)$/);
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(Number(range[2] || parquetBytes.byteLength - 1), parquetBytes.byteLength - 1);
          headers.set('Content-Range', `bytes ${start}-${end}/${parquetBytes.byteLength}`);
          headers.set('Content-Length', String(end - start + 1));
          return new Response(parquetBytes.slice(start, end + 1), { status: 206, headers });
        }
        return new Response(parquetBytes.slice(), { headers });
      },
    });
    const expectedVersion = `v${manifest.version.split('-')[0]}`;
    assert.equal(api.version(), expectedVersion);
    const db = new api.DuckDB({ customConfig: { threads: '1', memory_limit: '48MB' } });
    const conn = db.connect();
    try {
      assert.deepEqual(await conn.query('SELECT version() AS version'), [{ version: expectedVersion }]);
      const extensions = (await conn.query('SELECT extension_name FROM duckdb_extensions() WHERE loaded'))
        .map(row => row.extension_name);
      for (const name of ['parquet', 'httpfs']) {
        assert.ok(extensions.includes(name), `${name} must be available`);
      }
      for (const name of ['avro', 'iceberg', 'spatial', 'ducklake', 'json']) {
        assert.ok(!extensions.includes(name), `${name} belongs to a separate package`);
      }
      assert.deepEqual(await conn.query(
        "SELECT function_name FROM duckdb_functions() WHERE function_name IN ('read_avro', 'iceberg_scan')",
      ), []);
      await conn.execute("COPY (SELECT 42 AS value) TO 'fixture.parquet' (FORMAT PARQUET)");
      parquetBytes = await db.copyFileToBuffer('fixture.parquet');
      assert.deepEqual(await conn.query("SELECT * FROM read_parquet('https://fixture.test/data.parquet')"), [{ value: 42 }]);
      assert.ok(requests.includes('GET'), 'Parquet reader must fetch the remote fixture');
      await db.dropFile('fixture.parquet');
    } finally {
      conn.close();
      db.close();
    }
  });
}
