<img src="assets/logo.png" alt="Ducklings" width="200" />

A minimal DuckDB WASM binding for browsers and serverless environments.

## Packages

| Package | Environment | API Style |
|---------|-------------|-----------|
| [@ducklings/browser](https://www.npmjs.com/package/@ducklings/browser) | Browsers | Asynchronous (Web Worker) |
| [@ducklings/workers](https://www.npmjs.com/package/@ducklings/workers) | Cloudflare Workers* | Asynchronous (Asyncify) |

Both packages provide the same async API, but use different mechanisms under the hood.

> *The workers package requires a [Cloudflare Workers Paid Plan](https://developers.cloudflare.com/workers/platform/pricing/) due to WASM size (~9.7MB). Free plan limit is 3MB, paid plans support up to 10MB.

## Quick Start

### Installation

```bash
# For browsers
npm install @ducklings/browser

# For Cloudflare Workers
npm install @ducklings/workers
```

### Browser Usage

```typescript
import { init, DuckDB } from '@ducklings/browser';

// Initialize the WASM module (runs in Web Worker)
await init();

// Create database and connection
const db = new DuckDB();
const conn = await db.connect();

// Execute queries (async)
const rows = await conn.query('SELECT 42 as answer');
console.log(rows); // [{ answer: 42 }]

// Clean up
await conn.close();
await db.close();
```

### Cloudflare Workers Usage

```typescript
import { init, DuckDB } from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';

// Initialize with pre-compiled WASM module
await init({ wasmModule });

// Create database and connection
const db = new DuckDB();
const conn = db.connect();

// Execute queries (async)
const rows = await conn.query('SELECT 42 as answer');
console.log(rows); // [{ answer: 42 }]

// Clean up
conn.close();
db.close();
```

## Shared Async API

Both packages expose the same async API:

```typescript
// Works in both packages
const rows = await conn.query('SELECT * FROM range(10)');
const table = await conn.queryArrow('SELECT * FROM range(10)');
const affected = await conn.execute('INSERT INTO t VALUES (1)');
const results = await stmt.run();
```

## Features

- **Minimal footprint**: ~5.7MB (browser) / ~9.7MB (workers) gzipped
- **TypeScript**: Full type definitions included
- **Prepared statements**: Secure parameterized queries
- **Streaming results**: Memory-efficient chunked processing
- **Transactions**: BEGIN/COMMIT/ROLLBACK support
- **Arrow support**: Query results as Arrow Tables via Flechette
- **Parquet/JSON**: Built-in file format support
- **httpfs**: Load remote files via HTTP/HTTPS
- **File registration**: Register URLs, buffers, and text as virtual files

## Links

- [GitHub Repository](https://github.com/tobilg/ducklings)
- [@ducklings/browser on npm](https://www.npmjs.com/package/@ducklings/browser)
- [@ducklings/workers on npm](https://www.npmjs.com/package/@ducklings/workers)
