# Ducklings - Cloudflare Worker Iceberg Example

Minimal Cloudflare Worker example for querying Iceberg tables through Ducklings.

## Features

- Single `POST /query` endpoint
- One-time initialization during the first query request
- Automatic `CREATE SECRET` + `ATTACH` for a Cloudflare Data Catalog backed Iceberg catalog
- DuckDB WASM powered by `@ducklings/workers-iceberg`

## Required Worker Secrets

Set these in Wrangler or in the Cloudflare dashboard:

- `CF_R2_DATA_CATALOG_SECRET`
- `CF_ACCOUNT_ID`
- `CF_R2_BUCKET`

## Local Development

```bash
pnpm install
make duckdb-workers-iceberg
make typescript-workers-iceberg
cd packages/example-cloudflare-worker-iceberg
pnpm dev
```

## API

### `POST /query`

Request body:

```json
{ "sql": "SELECT * FROM r2lake.some_namespace.some_table LIMIT 10" }
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
