# Ducklings - Cloudflare Worker DuckLake Example

Minimal Cloudflare Worker example for querying a DuckLake catalog through Ducklings.

## Features

- Single `POST /query` endpoint
- One-time worker startup initialization
- Optional R2 secret setup for DuckLake data paths
- DuckDB WASM powered by `@ducklings/workers-ducklake`

## Required Worker Settings

This example requires a Cloudflare Workers paid plan. The bundled DuckDB WASM is close to the compressed Worker size limit, so run `wrangler deploy --dry-run --outdir bundled` after building to verify the final gzip size.

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
