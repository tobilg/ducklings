# Ducklings - Cloudflare Worker Example

This example uses `@ducklings/workers` with httpfs and Parquet to provide a SQL query API endpoint. For Avro or Iceberg, use the [Iceberg example](../example-cloudflare-worker-iceberg/).

## Features

- In-memory tables and queries
- Remote file access via httpfs (Parquet, CSV)
- Optional R2 bucket access via DuckDB secrets
- Arrow IPC stream output support

## Prerequisites

- Node.js 18+
- pnpm 9+
- Cloudflare account (choose a plan based on CPU and other runtime requirements)

## Local Development

```bash
# Install dependencies
pnpm install

# Build the worker
pnpm build

# Run locally with wrangler
pnpm dev
```

The worker will be available at `http://localhost:8787`.

## Deployment

```bash
# Build and deploy to Cloudflare
pnpm deploy
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | API info and available endpoints |
| `/query` | POST | Execute SQL query (body: `{ "sql": "..." }`) |
| `/arrow` | POST | Execute SQL and return Arrow IPC stream |
| `/users` | GET | List all sample users |
| `/orders` | GET | List all sample orders |
| `/stats` | GET | Order statistics by user |
| `/remote-parquet` | GET | Query remote Parquet file via httpfs |
| `/remote-csv` | GET | Query remote CSV file via httpfs |

### Example: Custom Query

```bash
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT 42 as answer"}'
```

### Example: Remote Parquet

```bash
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM '\''https://example.com/data.parquet'\'' LIMIT 10"}'
```

## R2 Bucket Access (Optional)

To query files stored in Cloudflare R2 buckets, configure the following secrets:

### 1. Create R2 API Token

1. Go to **Cloudflare Dashboard** > **R2** > **Manage R2 API Tokens**
2. Create a new API token with read access to your bucket(s)
3. Note the **Access Key ID** and **Secret Access Key**
4. Note your **Account ID** (found in the dashboard URL or account settings)

### 2. Set Worker Secrets

```bash
# Set each secret (you'll be prompted to enter the value)
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID
```

Or set them in the Cloudflare Dashboard under **Workers** > **Your Worker** > **Settings** > **Variables and Secrets**.

### 3. Query R2 Files

Once configured, you can query R2 files using the `r2://` URL scheme:

```bash
curl -X POST https://your-worker.workers.dev/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM '\''r2://your-bucket/path/to/file.parquet'\'' LIMIT 10"}'
```

## Project Structure

```
example-cloudflare-worker/
├── src/
│   └── index.ts          # Worker entry point
├── dist/                  # Build output (generated)
│   ├── index.js          # Bundled worker
│   └── duckdb-workers.wasm
├── vite.config.ts        # Vite build configuration
├── wrangler.jsonc        # Wrangler configuration
├── package.json
└── tsconfig.json
```

## Configuration

The worker is configured via `wrangler.jsonc`:

- **name**: Worker name (default: `ducklings-worker`)
- **compatibility_date**: Workers runtime version
- **compatibility_flags**: Includes `nodejs_compat` for Node.js API compatibility

## Notes

- **Bundle Size**: Both plans allow [64 MiB uncompressed per Worker](https://developers.cloudflare.com/workers/platform/limits/#worker-size), with no compressed-size limit. Run `wrangler deploy --dry-run --outdir bundled` and check `Total Upload` before deploying.
- **Cold Start**: First request may be slower due to WASM initialization. Subsequent requests reuse the initialized database.
- **Memory Limit**: Each isolate has 128 MB shared by JavaScript, WASM, HTTP buffers, and concurrent requests. DuckDB's `100MB` setting only controls its own memory budget; it does not cap total isolate usage.
- **CPU and I/O Budgets**: Free allows 10 ms CPU and 50 external subrequests per invocation. Paid defaults to 30 seconds CPU and 10,000 subrequests. DuckDB initialization runs on the first request and consumes that request's CPU budget. See the [runtime budget guide](../documentation/guides/browser-vs-workers.md#workers-runtime-budgets).
- **No Dynamic Extensions**: The standard build includes Parquet and httpfs. DuckDB's `json` extension is not bundled anymore, and `INSTALL`/`LOAD` will not add it at runtime.

## License

MIT
