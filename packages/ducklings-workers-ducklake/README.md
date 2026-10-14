# @ducklings/workers-ducklake

DuckDB WASM for Cloudflare Workers with `httpfs`, client-only `quack`, and `ducklake` statically bundled.

> This package targets Cloudflare Workers and uses Asyncify so DuckDB can perform async `fetch()`-backed I/O from WASM. Cloudflare allows [64 MiB uncompressed per Worker on both Free and Paid plans](https://developers.cloudflare.com/workers/platform/limits/#worker-size), with no compressed-size limit. Run `wrangler deploy --dry-run --outdir bundled` against your built Worker and check `Total Upload`. Choose a plan based on CPU and other runtime requirements.

## Installation

```bash
npm install @ducklings/workers-ducklake
```

## Usage

```typescript
import { init, DuckDB, AccessMode } from '@ducklings/workers-ducklake';
import wasmModule from '@ducklings/workers-ducklake/wasm';

await init({ wasmModule });

const db = new DuckDB({
  accessMode: AccessMode.READ_WRITE,
  lockConfiguration: true,
  customConfig: {
    memory_limit: '100MB',
    preserve_insertion_order: 'false',
  },
});

const conn = db.connect();
await conn.execute("ATTACH 'ducklake:metadata.ducklake' AS ducklake (DATA_PATH 's3://my-bucket/ducklake/')");
const result = await conn.query('SELECT * FROM ducklake.some_table LIMIT 10');
```

## Vite Plugin

```typescript
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { ducklingsWorkerPlugin } from '@ducklings/workers-ducklake/vite-plugin';

export default defineConfig({
  plugins: [ducklingsWorkerPlugin(), cloudflare()],
});
```

The plugin resolves `@ducklings/workers-ducklake/wasm` and copies the bundled WASM into the Cloudflare Worker output directory.

## Extension Set

| Package | Bundled extensions |
| --- | --- |
| `@ducklings/workers-ducklake` | `httpfs`, client-only `quack`, `ducklake` |
| `@ducklings/workers` | `httpfs`, `avro`, `iceberg` |

The published package does not bundle DuckDB's `json` extension to keep builds small.
