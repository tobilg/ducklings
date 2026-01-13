---
title: Browser vs Workers
group: Guides
---

# Browser vs Workers: Choosing the Right Package

Ducklings provides two packages optimized for different JavaScript runtime environments.

## Package Comparison

| Feature | @ducklings/browser | @ducklings/workers |
|---------|-------------------|-------------------|
| **Runtime** | Browsers | Cloudflare Workers |
| **Async mechanism** | Web Workers + postMessage | Asyncify (Emscripten) |
| **WASM size** | ~5.7MB | ~9.7MB |
| **HTTP support** | Via httpfs extension | Native async fetch() |
| **Threading** | Offloaded to Web Worker | Single-threaded |

## When to Use @ducklings/browser

Use the browser package when:

- Building web applications that run in browsers
- You want queries to run in a Web Worker (non-blocking UI)
- WASM size is a concern (smaller bundle)
- Using modern bundlers like Vite, webpack, or esbuild

```typescript
import { init, DuckDB } from '@ducklings/browser';

await init();
const db = new DuckDB();
const conn = await db.connect();

// Queries run in Web Worker, UI stays responsive
const result = await conn.query('SELECT * FROM large_table');
```

## When to Use @ducklings/workers

Use the workers package when:

- Deploying to Cloudflare Workers or similar serverless platforms
- You need async HTTP fetching inside DuckDB queries
- Building edge functions or serverless APIs

> **Important:** The workers package requires a [Cloudflare Workers Paid Plan](https://developers.cloudflare.com/workers/platform/pricing/) due to the WASM size (~9.7MB). The free plan has a 3MB limit, while paid plans support up to 10MB.

```typescript
import { init, DuckDB } from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';

export default {
  async fetch(request: Request): Promise<Response> {
    await init({ wasmModule });

    const db = new DuckDB();
    const conn = db.connect();

    // httpfs works natively with async fetch
    const result = await conn.query(
      "SELECT * FROM 'https://example.com/data.parquet' LIMIT 10"
    );

    conn.close();
    db.close();

    return Response.json(result);
  }
};
```

## Why Two Packages?

1. **Web Workers don't exist in Cloudflare Workers runtime** - The browser package uses Web Workers for non-blocking operations, but CF Workers has a different threading model.

2. **Asyncify adds ~4MB to WASM** - The workers package includes Emscripten's Asyncify which enables async operations (like fetch) inside WASM, but increases bundle size.

3. **Different optimization targets** - Browser builds prioritize size and UI responsiveness, while serverless builds prioritize async I/O compatibility.

## Shared API

Despite different internals, both packages expose the same async API:

```typescript
// Works in both packages
const rows = await conn.query('SELECT * FROM range(10)');
const table = await conn.queryArrow('SELECT * FROM range(10)');
await conn.execute('CREATE TABLE test (id INT)');
```

## Migration Between Packages

Switching between packages requires minimal code changes:

```typescript
// Browser
import { init, DuckDB } from '@ducklings/browser';
await init();
const db = new DuckDB();

// Workers
import { init, DuckDB } from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';
await init({ wasmModule });
const db = new DuckDB();
```

The connection and query APIs remain identical.
