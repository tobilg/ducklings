---
title: CDN Usage
group: Guides
---

# Loading from CDN

The `@ducklings/browser` package can be loaded directly from CDNs like jsDelivr or unpkg without any build step. This is useful for:

- Quick prototyping
- Static HTML pages
- Environments without bundlers

## Simple Usage

For most cases, you can simply import from the CDN and the library will automatically handle cross-origin worker creation:

```html
<!DOCTYPE html>
<html>
<head>
  <title>DuckDB CDN Example</title>
</head>
<body>
  <script type="module">
    import { init, DuckDB } from 'https://cdn.jsdelivr.net/npm/@ducklings/browser@1.4.3/+esm';

    await init();

    const db = new DuckDB();
    const conn = await db.connect();
    const result = await conn.query('SELECT 42 as answer');
    console.log(result);

    await conn.close();
    await db.close();
  </script>
</body>
</html>
```

## How It Works

When loading from a CDN, the library automatically detects cross-origin URLs and uses a Blob URL workaround. This is necessary because browsers block creating Web Workers from cross-origin scripts for security reasons.

The automatic detection:
1. Checks if the worker URL origin differs from `location.origin`
2. If cross-origin, fetches the worker script via `fetch()` (allowed with CORS)
3. Creates a Blob URL from the fetched content (same-origin)
4. Creates the Worker from the Blob URL

## CDN Bundle Utilities

For explicit control over CDN URLs, use the bundle helper functions:

```typescript
import {
  init,
  DuckDB,
  createWorker,
  getJsDelivrBundle,
  getUnpkgBundle,
} from 'https://cdn.jsdelivr.net/npm/@ducklings/browser@1.4.3/+esm';

// Get pre-configured bundle URLs for jsDelivr
const bundle = getJsDelivrBundle();
console.log(bundle);
// {
//   mainModule: 'https://cdn.jsdelivr.net/npm/@ducklings/browser@1.4.3/dist/index.js',
//   mainWorker: 'https://cdn.jsdelivr.net/npm/@ducklings/browser@1.4.3/dist/worker.js',
//   wasmModule: 'https://cdn.jsdelivr.net/npm/@ducklings/browser@1.4.3/dist/wasm/duckdb.wasm',
//   wasmJs: 'https://cdn.jsdelivr.net/npm/@ducklings/browser@1.4.3/dist/wasm/duckdb.js',
// }

// Or for unpkg
const unpkgBundle = getUnpkgBundle();

// Optionally specify a version
const oldBundle = getJsDelivrBundle('1.4.0');
```

## Manual Worker Creation

If you need to manually create the worker (e.g., for custom error handling):

```typescript
import {
  init,
  DuckDB,
  createWorker,
  getJsDelivrBundle,
} from 'https://cdn.jsdelivr.net/npm/@ducklings/browser@1.4.3/+esm';

const bundle = getJsDelivrBundle();

// Create worker manually with error handling
let worker;
try {
  worker = await createWorker(bundle.mainWorker);
} catch (error) {
  console.error('Failed to create worker:', error);
  throw error;
}

// Initialize with explicit options
await init({
  worker,
  wasmUrl: bundle.wasmModule,
  wasmJsUrl: bundle.wasmJs,
});

const db = new DuckDB();
const conn = await db.connect();
const result = await conn.query('SELECT 42 as answer');
console.log(result);
```

## Supported CDNs

### jsDelivr

```typescript
import { getJsDelivrBundle } from '@ducklings/browser';

const bundle = getJsDelivrBundle();
// URLs: https://cdn.jsdelivr.net/npm/@ducklings/browser@{version}/dist/...
```

### unpkg

```typescript
import { getUnpkgBundle } from '@ducklings/browser';

const bundle = getUnpkgBundle();
// URLs: https://unpkg.com/@ducklings/browser@{version}/dist/...
```

### Custom CDN

For other CDNs, use the `createWorker` function with your own URLs:

```typescript
import { init, createWorker } from '@ducklings/browser';

const cdnBase = 'https://your-cdn.com/@ducklings/browser@1.4.3/dist/';

const worker = await createWorker(`${cdnBase}worker.js`);

await init({
  worker,
  wasmUrl: `${cdnBase}wasm/duckdb.wasm`,
  wasmJsUrl: `${cdnBase}wasm/duckdb.js`,
});
```

## Version Constants

The library exports package information that can be useful for debugging:

```typescript
import { PACKAGE_NAME, PACKAGE_VERSION } from '@ducklings/browser';

console.log(PACKAGE_NAME);    // '@ducklings/browser'
console.log(PACKAGE_VERSION); // '1.4.3'
```

## Troubleshooting

### "Failed to construct 'Worker'" Error

This error occurs when the browser blocks cross-origin worker creation. The library should handle this automatically, but if you see this error:

1. Make sure you're using a recent version of `@ducklings/browser` (1.4.3+)
2. Ensure the CDN supports CORS headers
3. Try the manual worker creation approach shown above

### WASM Loading Fails

If WASM fails to load:

1. Check browser console for network errors
2. Verify the CDN URL is correct
3. Ensure Content-Type for `.wasm` files is `application/wasm`

## Next Steps

- [Getting Started](./getting-started.md) - Basic usage with npm
- [Browser vs Workers](./browser-vs-workers.md) - Choose the right package
- [File Registration](./file-registration.md) - Load remote data
