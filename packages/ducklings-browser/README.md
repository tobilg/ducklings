# @ducklings/browser

Minimal DuckDB WASM for browsers. Async worker-based API with full TypeScript support.

## Installation

```bash
npm install @ducklings/browser
```

## Quick Start

```typescript
import { init, DuckDB } from '@ducklings/browser';

// Initialize the WASM module (runs in Web Worker)
await init();

// Create database and connection
const db = new DuckDB();
const conn = await db.connect();

// Query returns array of JS objects
const rows = await conn.query<{answer: number}>('SELECT 42 as answer');
console.log(rows); // [{ answer: 42 }]

// Clean up
await conn.close();
await db.close();
```

## Features

- Async API - queries run in Web Worker, UI stays responsive
- ~5.7MB gzipped WASM
- Built-in Parquet, JSON, and httpfs extensions
- Arrow Table support via Flechette (query + insert)
- Prepared statements with type-safe parameter binding
- Streaming results for large datasets
- Transaction support
- File registration (URL, buffer, text)

## API

### Initialization

```typescript
import { init, DuckDB, version } from '@ducklings/browser';

// Auto-locate WASM and worker files
await init();

// Custom URLs (optional)
await init({
  wasmUrl: '/path/to/duckdb.wasm',
  workerUrl: '/path/to/worker.js'
});

// Create database
const db = new DuckDB();

// Get DuckDB version
const v = await version(); // "v1.4.3"
```

### CDN Usage

Load directly from jsDelivr or unpkg - cross-origin workers are handled automatically:

```html
<script type="module">
  import { init, DuckDB } from 'https://cdn.jsdelivr.net/npm/@ducklings/browser@1.4.3/+esm';

  await init();

  const db = new DuckDB();
  const conn = await db.connect();
  const result = await conn.query('SELECT 42 as answer');
  console.log(result); // [{ answer: 42 }]

  await conn.close();
  await db.close();
</script>
```

### Bundler Usage (Vite / Webpack)

When using a bundler, import asset URLs explicitly instead of relying on auto-resolution:

**Vite:**

```typescript
import { init, DuckDB } from '@ducklings/browser';
import wasmUrl from '@ducklings/browser/wasm/duckdb.wasm?url';
import wasmJsUrl from '@ducklings/browser/wasm/duckdb.js?url';
import workerUrl from '@ducklings/browser/worker?url';

await init({ wasmUrl, wasmJsUrl, workerUrl });
```

**Webpack:**

```typescript
import { init, DuckDB } from '@ducklings/browser';

const wasmUrl = new URL('@ducklings/browser/wasm/duckdb.wasm', import.meta.url).href;
const wasmJsUrl = new URL('@ducklings/browser/wasm/duckdb.js', import.meta.url).href;
const workerUrl = new URL('@ducklings/browser/worker', import.meta.url).href;

await init({ wasmUrl, wasmJsUrl, workerUrl });
```

### Query Methods

```typescript
const conn = await db.connect();

// Returns array of objects
const rows = await conn.query<{id: number, name: string}>('SELECT * FROM users');

// Returns Arrow Table (Flechette)
const table = await conn.queryArrow('SELECT * FROM users');

// Execute without returning results
await conn.execute('INSERT INTO users VALUES (1, "Alice")');

// Insert Arrow IPC data into a table
const ipc = tableToIPC(arrowTable, { format: 'stream' });
await conn.insertArrowFromIPCStream('my_table', ipc);
```

### Prepared Statements

```typescript
const stmt = await conn.prepare('SELECT * FROM users WHERE id = ? AND active = ?');
stmt.bindInt32(1, 42);      // Bind methods are sync
stmt.bindBoolean(2, true);
const results = await stmt.run();  // Execution is async
await stmt.close();
```

### Streaming Results

```typescript
const stream = await conn.queryStreaming('SELECT * FROM large_table');

for await (const chunk of stream) {
  console.log(`Processing ${chunk.rowCount} rows`);
  for (const row of chunk.toArray()) {
    processRow(row);
  }
}
// Stream auto-closes after iteration
```

### File Registration

```typescript
// Register remote file
await db.registerFileURL('data.parquet', 'https://example.com/data.parquet');

// Register in-memory data
const csvData = new TextEncoder().encode('id,name\n1,Alice');
await db.registerFileBuffer('data.csv', csvData);

// Query registered files
const rows = await conn.query("SELECT * FROM 'data.parquet'");
```

### Remote Files (httpfs)

```typescript
// Query remote Parquet file directly
const rows = await conn.query(`
  SELECT * FROM 'https://example.com/data.parquet'
  LIMIT 10
`);
```

### Arrow Support

```typescript
import { tableFromArrays, tableFromIPC, tableToIPC, utf8 } from '@ducklings/browser';

// Query as Arrow Table
const table = await conn.queryArrow('SELECT * FROM users');

// Build Arrow tables
const custom = tableFromArrays({
  id: [1, 2, 3],
  name: ['Alice', 'Bob', 'Charlie']
});

// Serialize to/from Arrow IPC
const bytes = tableToIPC(table, { format: 'stream' });
const restored = tableFromIPC(bytes);

// Insert Arrow IPC data directly into a table
const data = tableFromArrays(
  { id: [1, 2], label: ['x', 'y'] },
  { types: { label: utf8() } }  // Use plain utf8 (see note below)
);
const ipc = tableToIPC(data, { format: 'stream' });
await conn.insertArrowFromIPCStream('my_table', ipc);
```

> **Dictionary encoding:** Flechette's `tableFromArrays()` defaults to `dictionary(utf8())` for string columns. The Arrow IPC decoder used internally does not support dictionary-encoded streams. When building tables for `insertArrowFromIPCStream()`, explicitly set string columns to `utf8()`:
> ```typescript
> import { utf8 } from '@ducklings/browser';
> tableFromArrays({ col: ['a', 'b'] }, { types: { col: utf8() } });
> ```

## Cloudflare Workers

For Cloudflare Workers, use the [`@ducklings/workers`](https://www.npmjs.com/package/@ducklings/workers) package instead, which uses Asyncify for proper httpfs support in the Workers runtime.

## Limitations

- **No dynamic extension loading**: Only statically compiled extensions (Parquet, JSON, httpfs) are available. `INSTALL`/`LOAD` commands for other extensions will not work.

## License

MIT
