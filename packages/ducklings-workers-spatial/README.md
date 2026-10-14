# Ducklings spatial for Workers

DuckDB spatial, GEOS, PROJ, Parquet, and httpfs for Cloudflare Workers; GDAL and lakehouse extensions are omitted.

```sh
npm install @ducklings/workers-spatial
```

See [build and usage instructions](https://github.com/tobilg/ducklings/blob/main/docs/spatial-workers.md). Use `prepareAsync()` for remote Parquet statements and serialize native execution per Wasm instance.
