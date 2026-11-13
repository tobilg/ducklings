# @ducklings/workers-lite

DuckDB WASM for Cloudflare Workers **without Asyncify or httpfs**. It uses the
25 MB browser WASM instead of the 51 MB Asyncify Workers build, so an isolate
starts faster. Use it when the application registers its own files (for example
Parquet read from an R2 binding) and does not need DuckDB's httpfs.

```ts
import { init, DuckDB } from '@ducklings/workers-lite';
import wasmModule from '@ducklings/workers-lite/wasm';

await init({ wasmModule });
const db = new DuckDB();
const conn = db.connect();
await db.registerFileBuffer('lineitem.parquet', bytes);
const rows = await conn.query(
  "SELECT count(*) AS n FROM read_parquet('lineitem.parquet')",
);
```

The API is the same as `@ducklings/workers`; remote reads through `read_parquet('https://…')`
are not supported in this build.
