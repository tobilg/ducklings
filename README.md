![ducklings logo](docs/images/ducklings-150.png)

# Ducklings

A minimal DuckDB WASM build for browsers and Cloudflare Workers.

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`@ducklings/browser`](https://www.npmjs.com/package/@ducklings/browser) | Browser version (async API) | `npm install @ducklings/browser` |
| [`@ducklings/workers`](https://www.npmjs.com/package/@ducklings/workers) | Cloudflare Workers with httpfs and Parquet (async API) | `npm install @ducklings/workers` |
| [`@ducklings/workers-iceberg`](https://www.npmjs.com/package/@ducklings/workers-iceberg) | Cloudflare Workers with httpfs, Parquet, Avro, and Iceberg | `npm install @ducklings/workers-iceberg` |
| [`@ducklings/workers-ducklake`](https://www.npmjs.com/package/@ducklings/workers-ducklake) | Cloudflare Workers version with DuckLake (async API) | `npm install @ducklings/workers-ducklake` |
| [`@ducklings/workers-spatial`](https://www.npmjs.com/package/@ducklings/workers-spatial) | Cloudflare Workers build with Spatial, Parquet, and httpfs | `npm install @ducklings/workers-spatial` |

`@ducklings/workers` bundles only httpfs and Parquet. `@ducklings/workers-iceberg` adds Avro and Iceberg while keeping the same TypeScript API. Starting with 1.5.6, applications using Avro or Iceberg must use `@ducklings/workers-iceberg`, including its `/wasm` and `/vite-plugin` imports.

The spatial package statically links DuckDB Spatial with GEOS and PROJ and omits GDAL to keep the Worker bundle under Cloudflare's size limit. See [Spatial support for Cloudflare Workers](docs/spatial-workers.md) for build instructions, usage, and limitations.

## Documentation 

The API documentation can be found at [https://ducklings-api.gh.tobilg.com](https://ducklings-api.gh.tobilg.com)

## Try it out

You can try the browser package in an example  at [https://ducklings-browser.gh.tobilg.com/](https://ducklings-browser.gh.tobilg.com/)

## Features

- **Minimal footprint**: Optimized WASM builds; size depends on the bundled extensions (optimized with -Oz, LTO, wasm-opt)
- **TypeScript API**: Full TypeScript support with type definitions
- **Prepared statements**: Secure parameterized queries with full type support
- **Streaming results**: Memory-efficient chunked data processing
- **Transactions**: BEGIN/COMMIT/ROLLBACK with wrapper helpers
- **Arrow support**: Query results as Arrow Tables, insert data via Arrow IPC streams, powered by [Flechette](https://github.com/uwdata/flechette)
- **Parquet support**: Read Parquet files with built-in extension
- **httpfs support**: Load remote files via HTTP/HTTPS
- **JSON support**: Not bundled in the published browser or workers packages to keep builds small; use a custom build if you need DuckDB's `json` extension
- **Cloudflare Workers**: First-class support with dedicated Iceberg, DuckLake, and Spatial async packages
- **Browser support**: Works in modern browsers with ES modules

## Extension Availability

| Extension / Feature | `@ducklings/browser` | `@ducklings/workers` | `@ducklings/workers-iceberg` | `@ducklings/workers-ducklake` | `@ducklings/workers-spatial` |
|---------------------|---------------------|---------------------|----------------------------|-----------------------------|----------------------------|
| `parquet` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| `httpfs` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| `avro` | :white_check_mark: | :x: | :white_check_mark: | :x: | :x: |
| `iceberg` | :white_check_mark: | :x: | :white_check_mark: | :x: | :x: |
| `ducklake` | :x: | :x: | :x: | :white_check_mark: | :x: |
| `spatial` | :x: | :x: | :x: | :x: | :white_check_mark: |
| `json` | :x: | :x: | :x: | :x: | :x: |

The published browser and workers packages do not bundle DuckDB's `json` extension to keep builds small. JSON functions such as `json_extract(...)`, the `::JSON` type alias, and file readers like `read_json()` require a custom build with DuckDB's `json` extension enabled.

## Current Status

| Feature | Status |
|---------|--------|
| In-memory databases | :white_check_mark: |
| SQL queries | :white_check_mark: |
| Prepared statements | :white_check_mark: |
| Transactions | :white_check_mark: |
| Streaming results | :white_check_mark: |
| Arrow Table results | :white_check_mark: |
| Arrow IPC insert | :white_check_mark: |
| Parquet extension | :white_check_mark: |
| httpfs extension | :white_check_mark: |
| JSON extension | Custom build only |
| Cloudflare Workers | :white_check_mark: |
| Browser support | :white_check_mark: |

## Quick Start

### Browser

```bash
npm install @ducklings/browser
```

```typescript
import { init, DuckDB } from '@ducklings/browser';

// Initialize the WASM module (runs in Web Worker)
await init();

// Create a database and connection
const db = new DuckDB();
const conn = await db.connect();

// Execute queries - returns array of JS objects
const rows = await conn.query('SELECT 42 as answer');
console.log(rows); // [{ answer: 42 }]

// Or get results as Arrow Table
const table = await conn.queryArrow('SELECT * FROM range(5)');
console.log(table.numRows); // 5

// Clean up
await conn.close();
await db.close();
```

### Cloudflare Workers

```bash
npm install @ducklings/workers
```

Example Worker:

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

**Why two packages?** Cloudflare Workers doesn't support synchronous XMLHttpRequest (browser-only API). The workers package uses Emscripten's Asyncify to enable async `fetch()` calls, making httpfs work properly. The async API means all query methods return Promises.

| Package | API Style | Size (gzipped) | Extension focus |
|---------|-----------|----------------|-----------------|
| `@ducklings/browser` | Async (Web Worker) | ~6.3 MiB | Browser + Iceberg |
| `@ducklings/workers` | Async (Asyncify) | ~9.3 MiB | httpfs + Parquet |
| `@ducklings/workers-iceberg` | Async (Asyncify) | ~10 MiB | httpfs + Parquet + Avro + Iceberg |
| `@ducklings/workers-ducklake` | Async (Asyncify) | Measured during build | Workers + DuckLake |

#### Arrow IPC Endpoint

Return query results as Arrow IPC stream for efficient data transfer:

```typescript
import { init, DuckDB, tableToIPC } from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';

export default {
  async fetch(request: Request): Promise<Response> {
    await init({ wasmModule });

    const db = new DuckDB();
    const conn = db.connect();

    // Get results as Arrow Table
    const table = await conn.queryArrow('SELECT * FROM range(1000) t(i)');

    // Serialize to Arrow IPC stream format
    const ipcBytes = tableToIPC(table, { format: 'stream' });

    conn.close();
    db.close();

    return new Response(ipcBytes, {
      headers: {
        'Content-Type': 'application/vnd.apache.arrow.stream',
      },
    });
  }
};
```

Consume with any Arrow-compatible client:

```python
# Python
import pyarrow as pa
response = requests.get('https://your-worker.dev/arrow')
reader = pa.ipc.open_stream(response.content)
table = reader.read_all()
```

```typescript
// JavaScript (Flechette)
import { tableFromIPC } from '@ducklings/browser';
const response = await fetch('https://your-worker.dev/arrow');
const bytes = new Uint8Array(await response.arrayBuffer());
const table = tableFromIPC(bytes);
```

## API Reference

### Initialization

```typescript
// Browser - auto-locates WASM file
import { init } from '@ducklings/browser';
await init();

// Browser with Vite - use ?url imports for reliable asset resolution
import wasmUrl from '@ducklings/browser/wasm/duckdb.wasm?url';
import wasmJsUrl from '@ducklings/browser/wasm/duckdb.js?url';
import workerUrl from '@ducklings/browser/worker?url';
await init({ wasmUrl, wasmJsUrl, workerUrl });

// Browser - custom WASM URL
await init('/path/to/duckdb.wasm');

// Cloudflare Workers - use the workers package
import { init } from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';
await init({ wasmModule });
```

### CDN Usage (Browser)

Load directly from jsDelivr or unpkg - cross-origin workers are handled automatically:

```html
<script type="module">
  import { init, DuckDB } from 'https://cdn.jsdelivr.net/npm/@ducklings/browser@1.5.3/+esm';

  await init();

  const db = new DuckDB();
  const conn = await db.connect();
  const result = await conn.query('SELECT 42 as answer');
  console.log(result); // [{ answer: 42 }]

  await conn.close();
  await db.close();
</script>
```

### DuckDB Class

```typescript
// Create in-memory database
const db = new DuckDB();

// Or create with automatic initialization (browser only)
const db = await DuckDB.create();

// Create a connection
const conn = db.connect();

// Close the database
db.close();
```

### Security Configuration

Configure database security settings using `DuckDBConfig`:

```typescript
import { DuckDB, AccessMode } from '@ducklings/workers';

// Default configuration (secure defaults)
const db = new DuckDB();
// Equivalent to:
// new DuckDB({
//   accessMode: AccessMode.AUTOMATIC,
//   enableExternalAccess: true,
//   lockConfiguration: true,
// });

// Read-only mode - prevents any data modification
const readOnlyDb = new DuckDB({
  accessMode: AccessMode.READ_ONLY,
});

// Disable external access (disables httpfs)
const isolatedDb = new DuckDB({
  enableExternalAccess: false,
});

// Allow runtime config changes via SQL
const flexibleDb = new DuckDB({
  lockConfiguration: false,
});

// Custom configuration options
const customDb = new DuckDB({
  customConfig: {
    threads: '1',
  },
});
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `accessMode` | `AccessMode` | `AUTOMATIC` | Database access mode: `AUTOMATIC`, `READ_ONLY`, or `READ_WRITE` |
| `enableExternalAccess` | `boolean` | `true` | Enable httpfs and file I/O. Set to `false` to prevent all external data access |
| `lockConfiguration` | `boolean` | `true` | Lock configuration after startup. Prevents `SET` commands via SQL |
| `customConfig` | `Record<string, string>` | `{}` | Custom DuckDB configuration options |

#### Access Modes

| Mode | Description |
|------|-------------|
| `AccessMode.AUTOMATIC` | DuckDB determines mode (resolves to `READ_WRITE` for in-memory) |
| `AccessMode.READ_ONLY` | All write operations blocked |
| `AccessMode.READ_WRITE` | Allow both reads and writes |

### Connection Class

Both packages have an async API. All query methods return Promises.

```typescript
const conn = await db.connect();

// Query returning JS objects
const rows = await conn.query<{id: number, name: string}>('SELECT * FROM users');
// Returns: [{id: 1, name: 'Alice'}, {id: 2, name: 'Bob'}]

// Query returning Arrow Table (Flechette)
const table = await conn.queryArrow('SELECT * FROM users');
// Returns: Flechette Table with .numRows, .numCols, .schema, .toArray()

// Execute statement without returning results
await conn.execute('INSERT INTO users VALUES (1, "Alice")');

// Insert Arrow IPC data into a table
import { tableFromArrays, tableToIPC, utf8 } from '@ducklings/browser';
const arrow = tableFromArrays(
  { id: [1, 2], name: ['Alice', 'Bob'] },
  { types: { name: utf8() } }
);
await conn.insertArrowFromIPCStream('users', tableToIPC(arrow, { format: 'stream' }));

// Close the connection
await conn.close();
```

### Prepared Statements

```typescript
// Create a prepared statement
const stmt = await conn.prepare('SELECT * FROM users WHERE id = ? AND active = ?');

// Bind parameters (1-based index)
stmt.bindInt32(1, 42);
stmt.bindBoolean(2, true);

// Or use generic bind with type inference
stmt.bind(1, 42);        // number -> int32
stmt.bind(2, 'hello');   // string
stmt.bind(3, true);      // boolean
stmt.bind(4, null);      // null
stmt.bind(5, 123n);      // bigint -> int64

// Execute and get results
const results = await stmt.run();
console.log(results); // [{id: 42, name: 'Alice', active: true}]

// Clean up
await stmt.close();
```

#### Supported Parameter Types

| Method | TypeScript Type | DuckDB Type |
|--------|-----------------|-------------|
| `bindBoolean(idx, val)` | `boolean` | BOOLEAN |
| `bindInt32(idx, val)` | `number` | INTEGER |
| `bindInt64(idx, val)` | `bigint \| number` | BIGINT |
| `bindFloat(idx, val)` | `number` | FLOAT |
| `bindDouble(idx, val)` | `number` | DOUBLE |
| `bindString(idx, val)` | `string` | VARCHAR |
| `bindBlob(idx, val)` | `Uint8Array` | BLOB |
| `bindNull(idx)` | - | NULL |
| `bindDate(idx, val)` | `Date` | DATE |
| `bindTimestamp(idx, val)` | `Date` | TIMESTAMP |

### Transactions

```typescript
// Manual transaction control
await conn.beginTransaction();
try {
  await conn.query('INSERT INTO accounts VALUES (1, 1000)');
  await conn.query('UPDATE accounts SET balance = balance - 100 WHERE id = 1');
  await conn.commit();
} catch (e) {
  await conn.rollback();
  throw e;
}

// Or use the transaction wrapper (auto-rollback on error)
await conn.transaction(async () => {
  await conn.query('INSERT INTO orders VALUES (...)');
  await conn.query('UPDATE inventory SET qty = qty - 1');
  return 'success';
});
```

### Streaming Results

For large result sets, use streaming to process data in chunks:

```typescript
const stream = await conn.queryStreaming('SELECT * FROM large_table');

// Get metadata
console.log(stream.columnCount);  // Number of columns
console.log(stream.chunkCount);   // Number of chunks
console.log(stream.getColumns()); // Column info [{name, type}, ...]

// Iterate over chunks
for await (const chunk of stream) {
  console.log(`Chunk has ${chunk.rowCount} rows`);

  // Typed accessors
  for (let row = 0; row < chunk.rowCount; row++) {
    const id = chunk.getInt64(row, 0);
    const name = chunk.getString(row, 1);
    const active = chunk.getBoolean(row, 2);
    const isNull = chunk.isNull(row, 3);
  }

  // Or get entire column as array
  const ids = chunk.getColumn(0);
}
// Stream auto-closes after iteration
```

#### DataChunk Typed Accessors

| Method | Return Type | Description |
|--------|-------------|-------------|
| `getBoolean(row, col)` | `boolean` | Get boolean value |
| `getInt32(row, col)` | `number` | Get 32-bit integer |
| `getInt64(row, col)` | `number` | Get 64-bit integer (may lose precision) |
| `getBigInt(row, col)` | `bigint` | Get 64-bit integer as BigInt |
| `getDouble(row, col)` | `number` | Get double/float value |
| `getString(row, col)` | `string` | Get string value |
| `getDate(row, col)` | `number` | Get date as days since epoch |
| `getTimestamp(row, col)` | `number` | Get timestamp as microseconds |
| `getDateObject(row, col)` | `Date` | Get date/timestamp as JS Date |
| `getValue(row, col)` | `unknown` | Get value with auto type detection |
| `getJSON<T>(row, col)` | `T` | Parse JSON string to object |
| `isNull(row, col)` | `boolean` | Check if value is NULL |

### Arrow Support (Flechette)

```typescript
import { tableFromArrays, tableFromIPC, tableToIPC, utf8 } from '@ducklings/browser';

// Query as Arrow Table
const table = await conn.queryArrow('SELECT i, i*2 AS doubled FROM range(5) t(i)');
console.log(table.numRows);    // 5
console.log(table.numCols);    // 2
console.log(table.schema);     // Column metadata

// Build Arrow tables manually
const custom = tableFromArrays({
  id: [1, 2, 3],
  name: ['Alice', 'Bob', 'Charlie']
});

// Serialize to/from Arrow IPC
const bytes = tableToIPC(table);
const restored = tableFromIPC(bytes);

// Insert Arrow IPC data directly into a table
const data = tableFromArrays(
  { id: [1, 2, 3], label: ['a', 'b', 'c'] },
  { types: { label: utf8() } }  // Use plain utf8 (see note below)
);
const ipc = tableToIPC(data, { format: 'stream' });
await conn.insertArrowFromIPCStream('my_table', ipc);
```

> **Dictionary encoding:** Flechette's `tableFromArrays()` infers `dictionary(utf8())` for string columns by default. The Arrow IPC decoder used by `insertArrowFromIPCStream()` does not support dictionary-encoded IPC streams. When building tables for insertion, explicitly set string columns to `utf8()` via the `types` option:
> ```typescript
> import { utf8 } from '@ducklings/browser'; // or '@ducklings/workers'
> const table = tableFromArrays(
>   { name: ['Alice', 'Bob'] },
>   { types: { name: utf8() } }
> );
> ```

### Remote Files (httpfs)

Load data from remote HTTP/HTTPS sources:

```typescript
// Query remote Parquet file
const rows = await conn.query(`
  SELECT *
  FROM 'https://example.com/data.parquet'
  LIMIT 10
`);

// Query remote CSV file
const csvData = await conn.query(`
  SELECT *
  FROM read_csv('https://example.com/data.csv')
`);
```

`read_json('https://...')` is not available in the standard `@ducklings/browser`, `@ducklings/workers`, or `@ducklings/workers-ducklake` packages because they do not bundle DuckDB's `json` extension. It requires a custom build with that extension enabled.

### S3 and R2 Secrets

Access private S3-compatible storage (AWS S3, Cloudflare R2, Google Cloud Storage) using DuckDB secrets:

```typescript
// Create an S3 secret
await conn.execute(`
  CREATE SECRET my_s3 (
    TYPE S3,
    KEY_ID 'your-access-key-id',
    SECRET 'your-secret-access-key',
    REGION 'us-east-1'
  )
`);

// Query S3 files
const rows = await conn.query(`
  SELECT * FROM 's3://bucket-name/path/to/file.parquet'
`);

// Create a Cloudflare R2 secret
await conn.execute(`
  CREATE SECRET my_r2 (
    TYPE R2,
    KEY_ID 'your-r2-access-key-id',
    SECRET 'your-r2-secret-access-key',
    ACCOUNT_ID 'your-cloudflare-account-id'
  )
`);

// Query R2 files
const rows = await conn.query(`
  SELECT * FROM 'r2://bucket-name/path/to/file.parquet'
`);

// Create a Google Cloud Storage secret
await conn.execute(`
  CREATE SECRET my_gcs (
    TYPE GCS,
    KEY_ID 'your-gcs-key-id',
    SECRET 'your-gcs-secret'
  )
`);

// Query GCS files
const rows = await conn.query(`
  SELECT * FROM 'gcs://bucket-name/path/to/file.parquet'
`);
```

**Supported secret types:** `S3`, `R2`, `GCS`

See the [Cloudflare Workers example](./packages/example-cloudflare-worker/) for a complete example with environment-based R2 secrets.

### JSON Functions

The published `@ducklings/browser`, `@ducklings/workers`, and `@ducklings/workers-ducklake` packages do not bundle DuckDB's `json` extension so the artifacts stay small enough for Cloudflare Pages and Workers deployment.

If you need JSON functions such as `json_extract(...)`, the `::JSON` type alias, or file readers like `read_json()` / `read_ndjson_auto()`, build a custom WASM artifact with the `json` extension enabled.

#### DataChunk JSON Helper

For streaming results, use the `getJSON()` method to parse JSON-formatted string columns:

```typescript
const stream = await conn.queryStreaming(`
  SELECT '{"key": "value"}' AS data
`);

for await (const chunk of stream) {
  // Parses the JSON string value to an object
  const obj = chunk.getJSON<{key: string}>(0, 0);
  console.log(obj.key); // "value"
}
// Stream auto-closes after iteration
```

## Build Optimizations

The WASM binary is optimized for size using:

- **-Oz**: Maximum size optimization
- **LTO**: Link-Time Optimization (`-flto`)
- **emmalloc**: Smaller memory allocator
- **wasm-opt**: Binaryen post-processing with `-Oz --converge`
- **Reduced exports**: Only 59 essential C functions exported

WASM size depends on the package: the base Workers build omits Avro and Iceberg, while the Iceberg build includes them. None of the published packages bundles the JSON extension. Cloudflare permits [64 MiB uncompressed per Worker on both Free and Paid plans](https://developers.cloudflare.com/workers/platform/limits/#worker-size), with no compressed-size limit. Use `wrangler deploy --dry-run --outdir bundled` to check the final `Total Upload`, or run `bash scripts/check-worker-size.sh <example-package-directory>` after building the example. The script defaults to 65,536 KiB uncompressed; `DUCKLINGS_WORKER_TOTAL_LIMIT_KIB` overrides that budget, and `DUCKLINGS_WORKER_GZIP_LIMIT_KIB` enables an optional gzip budget. Browser static assets retain a separate 25 MiB per-file limit.

## Development

### Prerequisites

- Node.js 18+
- pnpm 8+
- Emscripten SDK (for DuckDB compilation)
- Binaryen (for wasm-opt)

### Setup

```bash
# Clone with submodules
git clone --recursive https://github.com/tobilg/ducklings.git
cd ducklings

# Install dependencies
pnpm install

# Initialize submodules
make deps
```

### Building

```bash
# Full build (browser WASM + TypeScript)
make all

# Build both browser and workers WASM
make duckdb-all

# Build browser, base Workers, Iceberg, and DuckLake TypeScript packages
make typescript-all

# Individual steps
make duckdb-browser     # Compile browser WASM (~2 min)
make duckdb-workers     # Compile httpfs/Parquet workers WASM with Asyncify
make duckdb-workers-iceberg # Compile workers WASM with Avro and Iceberg
make duckdb-workers-ducklake # Compile DuckLake workers WASM with Asyncify
make typescript-browser # Build @ducklings/browser package
make typescript-workers # Build @ducklings/workers package
make typescript-workers-iceberg # Build @ducklings/workers-iceberg package
make typescript-workers-ducklake # Build @ducklings/workers-ducklake package

# Clean and rebuild
make clean && make all
```

### Versioning

All npm packages use the same version, derived from `DUCKDB_VERSION` in the Makefile:

```
Makefile: DUCKDB_VERSION := v1.5.6
                ↓
    @ducklings/browser@1.5.6
    @ducklings/workers@1.5.6
    @ducklings/workers-iceberg@1.5.6
    @ducklings/workers-ducklake@1.5.6
    @ducklings/workers-spatial@1.5.6
```

To update the version, change `DUCKDB_VERSION` in the Makefile. The version is automatically synced to package manifests during the build process via `make sync-versions`.

```bash
# Manually sync versions (also runs automatically during typescript builds)
make sync-versions

# Show current versions
make show-versions
```

#### Dev Releases

For development/prerelease versions, use `VERSION_SUFFIX`:

```bash
# Build with dev version suffix
make sync-versions VERSION_SUFFIX=-dev.1
make show-versions VERSION_SUFFIX=-dev.1
# Output: npm packages: 1.5.0-dev.1
```

Or set it in the Makefile:

```makefile
VERSION_SUFFIX := -dev.1    # Results in 1.5.0-dev.1
VERSION_SUFFIX := -alpha.0  # Results in 1.5.0-alpha.0
VERSION_SUFFIX := -beta.1   # Results in 1.5.0-beta.1
VERSION_SUFFIX := -rc.1     # Results in 1.5.0-rc.1
VERSION_SUFFIX :=           # Empty for stable release
```

Dev versions are published to npm with the `dev` tag:

```bash
# Install latest stable
npm install @ducklings/browser

# Install latest dev version
npm install @ducklings/browser@dev
```

#### Release Process

All five packages use npm trusted publishing. Complete the [npm setup and initial Spatial/Iceberg publications](docs/publishing.md) before running a publishing release; no `NPM_TOKEN` is used by the workflow. Dry runs upload tested Spatial and Iceberg npm tarballs for their first publications.

**Stable release (new DuckDB version):**

1. Update `DUCKDB_VERSION` in Makefile:
   ```makefile
   DUCKDB_VERSION := v1.5.6
   VERSION_SUFFIX :=
   ```

2. Update the DuckDB submodule after removing locally applied build patches:
   ```bash
   git -C deps/duckdb apply --reverse ../../patches/duckdb/preloaded_extensions.patch
   git -C deps/duckdb fetch origin tag v1.5.6
   git -C deps/duckdb checkout v1.5.6
   make sync-versions
   ```

   Skip the reverse-patch command on a clean checkout. Preserve any intentional source edits before switching versions. To also update the extension branches, use `make pin-versions`; it fast-forwards every configured dependency branch.

3. Rebuild and validate all five variants:
   ```bash
   rm -rf build/emscripten build/emscripten-spatial dist
   make duckdb-all
   make duckdb-workers-spatial
   make typescript-all
   make typescript-workers-spatial
   pnpm --filter @ducklings/browser --filter @ducklings/workers --filter @ducklings/workers-iceberg --filter @ducklings/workers-ducklake --filter @ducklings/workers-spatial -r typecheck
   pnpm --filter @ducklings/browser --filter @ducklings/workers --filter @ducklings/workers-iceberg --filter @ducklings/workers-ducklake -r test
   make check-worker-spatial-size
   pnpm --filter @ducklings/example-cloudflare-worker-spatial test
   ```

   The tests check that both the API and SQL report the DuckDB version configured in the Makefile. Also smoke-test remote data access and check the final browser and Worker bundle sizes before releasing.

4. Commit the Makefile, updated submodule references, package manifests, and any compatibility fixes, then tag:
   ```bash
   git add -A
   git commit -m "Bump DuckDB to v1.5.6"
   git tag v1.5.6
   git push origin main --tags
   ```

   CI and release builds use the committed submodule references; changing only `DUCKDB_VERSION` does not update the engine they compile.

5. The release workflow automatically:
   - Validates tag matches `DUCKDB_VERSION`
   - Builds WASM binaries
   - Publishes to npm with `latest` tag
   - Creates GitHub release

**Dev release (manual dispatch):**

1. Go to Actions → Release → Run workflow
2. Enter version suffix (e.g., `-dev.1`)
3. Optionally enable dry run
4. Run workflow

The workflow publishes with `--tag dev` so it won't affect `latest`.

### Build Process

```
                              ┌─────────────────────┐
                              │   deps/duckdb/      │
                              │   (C++ source)      │
                              └─────────┬───────────┘
                                        │
                                        ▼
                              ┌─────────────────────┐
                              │  deps/duckdb-httpfs │
                              │  (httpfs extension) │
                              └─────────┬───────────┘
                                        │
            ┌───────────────────────────┼───────────────────────────┐
            │                           │                           │
            ▼                           │                           ▼
┌───────────────────────┐               │               ┌───────────────────────┐
│   Emscripten (em++)   │               │               │   Emscripten (em++)   │
│   Browser build       │               │               │   Workers build       │
│   -Oz, LTO            │               │               │   -Oz, LTO, ASYNCIFY  │
└───────────┬───────────┘               │               └───────────┬───────────┘
            │                           │                           │
            ▼                           │                           ▼
┌───────────────────────┐               │               ┌───────────────────────┐
│   wasm-opt -Oz        │               │               │   wasm-opt -Oz        │
│   (Binaryen)          │               │               │   (Binaryen)          │
└───────────┬───────────┘               │               └───────────┬───────────┘
            │                           │                           │
            ▼                           │                           ▼
┌───────────────────────┐               │               ┌───────────────────────┐
│   dist/               │               │               │   dist/               │
│   ├── duckdb.js       │               │               │   ├── duckdb-workers  │
│   └── duckdb.wasm     │               │               │   │   .js             │
│      (~6.3MiB gz)     │               │               │   └── duckdb-workers  │
└───────────┬───────────┘               │               │       .wasm (base)    │
            │                           │               └───────────┬───────────┘
            │                           │                           │
            ▼                           │                           ▼
┌───────────────────────┐               │               ┌───────────────────────┐
│   tsup (TypeScript)   │               │               │   tsup (TypeScript)   │
│   packages/duckdb-    │               │               │   packages/duckdb-    │
│   wasm-nano/          │               │               │   wasm-nano-workers/  │
└───────────┬───────────┘               │               └───────────┬───────────┘
            │                           │                           │
            ▼                           │                           ▼
┌───────────────────────┐               │               ┌───────────────────────┐
│   npm package         │               │               │   npm package         │
│   @ducklings/browser  │◄──────────────┴──────────────►│   @ducklings/workers  │
│   (async API)         │                               │   (async API)         │
└───────────────────────┘                               └───────────────────────┘
```

### Project Structure

```
ducklings/
├── Makefile                       # Build orchestration
├── deps/                          # Git submodules
│   └── duckdb/                    # DuckDB v1.5.0
├── dist/                          # WASM build output
│   ├── duckdb.js                  # Browser JS glue
│   ├── duckdb.wasm                # Browser WASM (~6.3 MiB gzipped)
│   ├── duckdb-workers.js          # Base Workers JS glue (with Asyncify)
│   ├── duckdb-workers.wasm        # Base Workers WASM (httpfs + Parquet)
│   ├── duckdb-workers-iceberg.js  # Iceberg Workers JS glue
│   ├── duckdb-workers-iceberg.wasm # Iceberg Workers WASM
│   ├── duckdb-workers-ducklake.js # DuckLake Workers JS glue (with Asyncify)
│   └── duckdb-workers-ducklake.wasm # DuckLake Workers WASM
├── packages/
│   ├── ducklings-browser/         # @ducklings/browser (npm)
│   │   ├── src/index.ts           # Browser entry point
│   │   └── dist/                  # Built package
│   │       ├── index.js           # ESM bundle
│   │       └── wasm/              # WASM files
│   ├── ducklings-workers-shared/  # Shared Workers API implementation
│   ├── ducklings-workers/         # @ducklings/workers (npm; default)
│   ├── ducklings-workers-iceberg/ # @ducklings/workers-iceberg (npm)
│   │   ├── src/index.ts           # Iceberg Workers package entry
│   │   └── dist/                  # Built package
│   │       ├── index.js           # ESM bundle
│   │       └── wasm/              # WASM files
│   ├── ducklings-workers-ducklake/ # @ducklings/workers-ducklake (npm)
│   │   ├── src/index.ts           # DuckLake Workers package entry
│   │   └── dist/                  # Built package
│   │       ├── index.js           # ESM bundle
│   │       └── wasm/              # WASM files
│   ├── example-browser/           # Browser example
│   └── example-cloudflare-worker/ # CF Workers example
├── .github/
│   └── workflows/
│       ├── ci.yml                 # CI workflow (build, test)
│       └── release.yml            # Release workflow (npm publish)
└── scripts/
    └── build-duckdb.sh            # Emscripten build script
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TypeScript API (packages/)                   │
│  init() → DuckDB → Connection → query() / prepare() / stream()  │
├─────────────────────────────────────────────────────────────────┤
│              PreparedStatement / StreamingResult                │
│  Parameter binding, chunked iteration, typed accessors          │
├─────────────────────────────────────────────────────────────────┤
│                 Flechette (Arrow Tables)                        │
│  tableFromArrays() for building Arrow from columnar data        │
├─────────────────────────────────────────────────────────────────┤
│               Emscripten JS Glue (ccall/cwrap)                  │
│  Type marshalling, memory management, HEAP access               │
├─────────────────────────────────┬───────────────────────────────┤
│  @ducklings/browser             │   @ducklings/workers          │
│  Browser WASM (~6.3MiB gz)      │   Workers WASM (base)        │
│  - Web Worker + XMLHttpRequest  │   - Asyncify + fetch()        │
│  - Async API (Promises)         │   - Async API (Promises)      │
└─────────────────────────────────┴───────────────────────────────┘
```

## Known Limitations

1. **WASM Size**: Browser WASM must fit the 25 MiB static-asset limit. Workers bundles must fit 64 MiB uncompressed on both plans; use Wrangler dry-run to verify the final upload size. CPU and other runtime limits still differ by plan.
2. **No file system**: In-memory databases only (use httpfs for remote files)
3. **No threads**: Single-threaded execution
4. **WASM_BIGINT=0**: 64-bit integers passed as two 32-bit values (handled internally)
5. **No dynamic extension loading**: Only statically compiled extensions are available. The default Workers build includes Parquet and httpfs. The browser and Workers Iceberg builds additionally include Avro and Iceberg. None includes JSON. `INSTALL`/`LOAD` commands for other extensions will not work. Dynamic loading requires Emscripten's `-sMAIN_MODULE` flag which significantly increases binary size (~2-3x)

## License

MIT
