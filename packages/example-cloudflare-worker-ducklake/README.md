# Ducklings - Cloudflare Worker DuckLake Example

Minimal Cloudflare Worker example for querying a DuckLake catalog through Ducklings.

## Features

- Single `POST /query` endpoint
- One-time initialization during the first query request
- Optional R2 secret setup for DuckLake data paths
- DuckDB WASM powered by `@ducklings/workers-ducklake`

## Required Worker Settings

Cloudflare allows [64 MiB uncompressed per Worker on both Free and Paid plans](https://developers.cloudflare.com/workers/platform/limits/#worker-size), with no compressed-size limit. Run `wrangler deploy --dry-run --outdir bundled` after building and check `Total Upload`. Choose a plan based on CPU and other runtime requirements.

Set these as Wrangler variables or Worker secrets:

- `DUCKLAKE_METADATA_PATH`: DuckLake attach path, for example `ducklake:metadata.ducklake`
- `DUCKLAKE_DATA_PATH`: DuckLake data path, for example `s3://my-bucket/ducklake/`

Set these secrets when `DUCKLAKE_DATA_PATH` points at R2/S3:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ACCOUNT_ID`

## Local Development

```bash
pnpm install
make duckdb-workers-ducklake
make typescript-workers-ducklake
cd packages/example-cloudflare-worker-ducklake
pnpm dev
```

## API

### `POST /query`

Request body:

```json
{ "sql": "SELECT * FROM ducklake.some_table LIMIT 10" }
```

Successful response:

```json
{
  "success": true,
  "data": [],
  "rowCount": 0
}
```

Error response:

```json
{
  "error": "..."
}
```
