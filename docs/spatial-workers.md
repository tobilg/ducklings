# Spatial support for Cloudflare Workers

The `@ducklings/workers-spatial` package statically links DuckDB spatial, Parquet, and httpfs with GEOS and PROJ. GDAL readers such as `ST_Read` and the lakehouse extensions are omitted. The release workflow builds, tests, and publishes this package alongside the other variants.

```sh
npm install @ducklings/workers-spatial
```

Maintainers must complete the [initial npm publication and trusted publisher setup](publishing.md) before the first automated release.

## Build

Use Node.js 22+, pnpm, CMake, Python/uv, and Emscripten **4.0.22**. Initialize the pinned submodules, activate the SDK, and put its `wasm-opt` on PATH:

```sh
git submodule update --init --recursive
source /path/to/emsdk/emsdk_env.sh
export PATH="$EMSDK/upstream/bin:$PATH"
export DUCKLINGS_BUILD_JOBS=4
export VCPKG_MAX_CONCURRENCY=4
pnpm install --frozen-lockfile
make duckdb-workers-spatial
make typescript-workers-spatial
make check-worker-spatial-size
pnpm --filter @ducklings/example-cloudflare-worker-spatial test
```

The build downloads/builds pinned dependencies with vcpkg, applies the checked-in patches idempotently, and writes `dist/duckdb-workers-spatial.{js,wasm}`. Incremental builds reuse `build/emscripten-spatial/`.

All variants share the vcpkg installation. Spatial's dependency patches are applied before that installation even when the browser is built first, and vcpkg checks package ABIs on each build to replace libraries built with older patches or toolchains. Keep the Spatial submodule initialized for browser and lakehouse builds too.

## Usage

```ts
import { init, DuckDB } from '@ducklings/workers-spatial';
import wasmModule from '@ducklings/workers-spatial/wasm/duckdb-workers.wasm';

await init({ wasmModule });
const db = new DuckDB({ customConfig: { threads: '1', memory_limit: '48MB' } });
const connection = await db.connect();
try {
  const rows = await connection.query('SELECT ST_AsGeoJSON(ST_Point(1, 2)) AS geometry');
  console.log(rows);
} finally {
  await connection.close();
  await db.close();
}
```

Use `prepareAsync()` when preparing statements against remote Parquet, and close prepared statements in `finally` blocks. An Asyncify module must not execute overlapping native calls: serialize/admit work per module instance. The local example demonstrates serialized requests, not production overload handling.

## Scope and checks

- The local Worker bundle measured about 54.6 MiB; the included size check validates the configured uncompressed budget. Actual deployment limits must be checked for your account.
- Wasm linear memory is capped at 96 MiB. DuckDB's memory limit does not cover every allocation or establish total Worker memory safety.
- The native `ST_AsGeoJSON` patch copies each final string into result storage and resets temporary JSON arena allocations per row. This prevents temporary JSON trees accumulating across a vector.
- Prepared-result cleanup now destroys native results on success and failure. HTTP transport preserves supplied headers and supports the scoped headers needed by remote Parquet reads.
- The local workerd integration test covers spatial predicates, precision-reduced GeoJSON, projection, an R-tree, remote GeoParquet range reads, prepared parameters, repeated requests, and a 4,097-row/null serializer lifetime regression.

Run the integration test locally; it does not deploy. The example and package contain no application-specific routes, datasets, account credentials, or production service bindings.
