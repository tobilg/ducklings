# Local spatial Worker integration test

Build `@ducklings/workers-spatial`, then run `pnpm test` here. The test starts local workerd and a loopback HTTP fixture server. It checks spatial operations, GeoParquet range reads, prepared parameters, repeated requests, and multi-vector GeoJSON string lifetime. `pnpm size` performs a deployment dry run only.

See [spatial build instructions](../../docs/spatial-workers.md).
