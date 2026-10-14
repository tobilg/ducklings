---
title: Browser vs Workers
group: Guides
---

# Browser vs Workers: Choosing the Right Package

Ducklings provides packages optimized for different JavaScript runtime environments.

## Package Comparison

| Feature | @ducklings/browser | @ducklings/workers | @ducklings/workers-iceberg | @ducklings/workers-ducklake |
| --------- | ------------------- | ------------------- | ---------------------------- | ------------------------------- |
| **Runtime** | Browsers | Cloudflare Workers | Cloudflare Workers | Cloudflare Workers |
| **Async mechanism** | Web Workers + postMessage | Asyncify (Emscripten) | Asyncify (Emscripten) | Asyncify (Emscripten) |
| **WASM size (gzipped)** | ~6.3 MiB | ~9.3 MiB | ~10 MiB | ~10 MiB |
| **HTTP support** | Via httpfs extension | Native async fetch() | Native async fetch() | Native async fetch() |
| **Lakehouse extension** | Iceberg | None | Iceberg | DuckLake |
| **JSON extension** | Not bundled | Not bundled | Not bundled | Not bundled |
| **Threading** | Offloaded to Web Worker | Single-threaded | Single-threaded | Single-threaded |

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
- You need remote Parquet or CSV access without lakehouse extensions
- Building edge functions or serverless APIs

Use `@ducklings/workers-iceberg` for Avro and Iceberg support, or `@ducklings/workers-ducklake` for DuckLake. Each adds its extensions to httpfs and Parquet. Use the matching package name for the API, `/wasm`, and `/vite-plugin` imports.

> Cloudflare allows [64 MiB uncompressed per Worker on both Free and Paid plans](https://developers.cloudflare.com/workers/platform/limits/#worker-size), with no compressed-size limit. Use `wrangler deploy --dry-run --outdir bundled` after each build and check `Total Upload`. Choose a plan based on CPU and other runtime requirements.

### Workers runtime budgets

The following [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/) were checked on October 14, 2026:

| Resource | Free | Paid |
|----------|------|------|
| Memory per isolate, including JavaScript and WASM | 128 MB | 128 MB |
| CPU per HTTP request | 10 ms | 30 seconds by default; configurable up to 5 minutes |
| External subrequests per invocation | 50 | 10,000 by default; configurable up to 10 million |
| Subrequests to internal services | 1,000 | Same configured subrequest limit |
| Connections waiting for response headers | 6 | 6 |
| Top-level startup | 1 second | 1 second |
| Requests per day | 100,000 | No daily limit |

Remote Parquet and Iceberg queries may make many HTTP requests, and redirects count toward the subrequest budget. HTTP connections stop counting toward the six-connection limit when their response headers arrive; outbound WebSockets also count. The examples initialize DuckDB lazily during the first request, so that work uses the request's CPU budget. Waiting for network I/O does not consume CPU time. HTTP requests have no hard wall-clock limit while the client remains connected; background work through `waitUntil()` has up to 30 seconds after response or disconnection.

The examples set DuckDB's `memory_limit` to `100MB`, and the build caps WASM linear memory at `128MB`. Neither setting caps total isolate usage: JavaScript, HTTP response buffers, query results, and concurrent requests share the same platform memory budget. The HTTP bridge buffers each fetched response before copying it into WASM; keep individual reads and result sets bounded even though Cloudflare has no response-body size limit. Incoming request-body limits depend on the Cloudflare account plan, separately from the Workers plan.

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
