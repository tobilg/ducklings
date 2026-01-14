# @ducklings/workers

Minimal DuckDB WASM for Cloudflare Workers and serverless environments. Async API with full TypeScript support.

> **Important:** This package requires a [Cloudflare Workers Paid Plan](https://developers.cloudflare.com/workers/platform/pricing/) due to the WASM size (~9.7MB). The free plan has a 3MB limit, while paid plans support up to 10MB.

## Installation

```bash
npm install @ducklings/workers
```

## Quick Start

```typescript
import { init, DuckDB } from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';

export default {
  async fetch(request: Request): Promise<Response> {
    // Initialize with pre-compiled WASM module
    await init({ wasmModule });

    const db = new DuckDB();
    const conn = db.connect();

    // All queries are async
    const rows = await conn.query<{answer: number}>('SELECT 42 as answer');

    conn.close();
    db.close();

    return Response.json(rows);
  }
};
```

## Singleton Initialization (Recommended)

For production use, reuse the database and connection across requests to avoid re-initialization overhead:

```typescript
import { init, DuckDB, type Connection } from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';

// Global state (reused across requests in the same Worker instance)
let db: DuckDB | null = null;
let conn: Connection | null = null;
let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (initialized && db && conn) {
    return;
  }

  await init({ wasmModule });
  db = new DuckDB();
  conn = db.connect();
  initialized = true;
}

export default {
  async fetch(request: Request): Promise<Response> {
    await ensureInitialized();

    const rows = await conn!.query('SELECT 42 as answer');
    return Response.json(rows);
  }
};
```

## Vite Plugin

For projects using Vite with `@cloudflare/vite-plugin` to build Cloudflare Workers, we provide a plugin that handles WASM file resolution and copying:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { ducklingsWorkerPlugin } from '@ducklings/workers/vite-plugin';

export default defineConfig({
  plugins: [
    ducklingsWorkerPlugin(),
    cloudflare(),
  ],
});
```

### Plugin Options

```typescript
ducklingsWorkerPlugin({
  // Name of the WASM file in the output directory (default: 'duckdb-workers.wasm')
  wasmFileName: 'duckdb-workers.wasm',
})
```

The plugin:
- Resolves `@ducklings/workers/wasm` imports to a relative path for wrangler
- Automatically copies the WASM file to the correct output directory (works with Cloudflare vite plugin's nested output structure)

## Features

- Async API - all query methods return Promises
- ~9.7MB gzipped WASM (includes Asyncify)
- Built-in Parquet, JSON, and httpfs extensions
- Full httpfs support via async `fetch()`
- Arrow Table support via Flechette
- Prepared statements with type-safe parameter binding
- Transaction support

## Why a Separate Package?

Cloudflare Workers doesn't support synchronous XMLHttpRequest (a browser-only API). This package uses Emscripten's Asyncify to enable async `fetch()` calls, making httpfs work properly for loading remote Parquet, CSV, and JSON files.

| Package | API Style | Size (gzipped) | httpfs |
|---------|-----------|----------------|--------|
| `@ducklings/browser` | Async (Web Worker) | ~5.7 MB | XMLHttpRequest |
| `@ducklings/workers` | Async (Asyncify) | ~9.7 MB | fetch() via Asyncify |

## API

### Initialization

```typescript
import { init, version } from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';

// Initialize with pre-compiled WASM
await init({ wasmModule });

// Get DuckDB version
console.log(version()); // "v1.4.3"
```

### Query Methods (Async)

```typescript
const conn = db.connect();

// Returns array of objects
const rows = await conn.query<{id: number, name: string}>('SELECT * FROM users');

// Returns Arrow Table (Flechette)
const table = await conn.queryArrow('SELECT * FROM users');

// Execute without returning results
await conn.execute('INSERT INTO users VALUES (1, "Alice")');
```

### Prepared Statements

```typescript
const stmt = conn.prepare('SELECT * FROM users WHERE id = ? AND active = ?');
stmt.bindInt32(1, 42);
stmt.bindBoolean(2, true);
const results = await stmt.run();  // Note: async
stmt.close();
```

### Remote Files (httpfs)

```typescript
// Query remote Parquet file
const rows = await conn.query(`
  SELECT * FROM 'https://example.com/data.parquet'
  LIMIT 10
`);

// Query remote CSV
const csv = await conn.query(`
  SELECT * FROM read_csv('https://example.com/data.csv')
`);

// Query remote JSON
const json = await conn.query(`
  SELECT * FROM read_json('https://example.com/data.json')
`);
```

### R2 Secrets

Access private S3-compatible storage using DuckDB secrets:

```typescript

// Cloudflare R2
await conn.execute(`
  CREATE SECRET my_r2 (
    TYPE R2,
    KEY_ID 'your-r2-access-key-id',
    SECRET 'your-r2-secret-access-key',
    ACCOUNT_ID 'your-cloudflare-account-id'
  )
`);
const r2Data = await conn.query(`SELECT * FROM 'r2://bucket/file.parquet'`);
```

**Supported secret types:** `S3`, `R2`, `GCS`

For Cloudflare Workers, you can use [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) to securely store credentials. See the [example worker](https://github.com/tobilg/ducklings/tree/main/packages/example-cloudflare-worker) for a complete implementation.

### Arrow IPC Endpoint

Return query results as Arrow IPC stream for efficient data transfer:

```typescript
import { init, DuckDB, tableToIPC } from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';

export default {
  async fetch(request: Request): Promise<Response> {
    await init({ wasmModule });

    const db = new DuckDB();
    const conn = db.connect();

    const table = await conn.queryArrow('SELECT * FROM range(1000) t(i)');
    const ipcBytes = tableToIPC(table, { format: 'stream' });

    conn.close();
    db.close();

    return new Response(ipcBytes, {
      headers: { 'Content-Type': 'application/vnd.apache.arrow.stream' },
    });
  }
};
```

### Transactions

```typescript
// Manual control
await conn.beginTransaction();
try {
  await conn.query('INSERT INTO accounts VALUES (1, 1000)');
  await conn.commit();
} catch (e) {
  await conn.rollback();
  throw e;
}

// Or use the wrapper (auto-rollback on error)
await conn.transaction(async () => {
  await conn.query('INSERT INTO orders VALUES (...)');
  return 'success';
});
```

### Arrow Support

```typescript
import { tableFromArrays, tableFromIPC, tableToIPC } from '@ducklings/workers';

// Query as Arrow Table
const table = await conn.queryArrow('SELECT * FROM users');

// Build Arrow tables
const custom = tableFromArrays({
  id: [1, 2, 3],
  name: ['Alice', 'Bob', 'Charlie']
});

// Serialize/deserialize Arrow IPC
const bytes = tableToIPC(table);
const restored = tableFromIPC(bytes);
```

## Browser Usage

For browser environments, use [`@ducklings/browser`](https://www.npmjs.com/package/@ducklings/browser) instead, which has a smaller WASM size (~5.7MB) and runs queries in a Web Worker.

## Limitations

- **No dynamic extension loading**: Only statically compiled extensions (Parquet, JSON, httpfs) are available. `INSTALL`/`LOAD` commands for other extensions will not work.

## License

MIT
