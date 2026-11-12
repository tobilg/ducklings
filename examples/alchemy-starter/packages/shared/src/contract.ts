import * as Schema from "effect/Schema";

import { DatasetDefinition } from "./dataset";
import { QueryCategory, QueryDefinition } from "./queries";

/** A cell is whatever DuckDB's JSON-safe projection produced. */
export const Cell = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
]);
export type Cell = typeof Cell.Type;

export const BenchmarkMode = Schema.Literals(["warm", "cold"]);
export type BenchmarkMode = typeof BenchmarkMode.Type;

export class DatasetFileStatus extends Schema.Class<DatasetFileStatus>(
  "DatasetFileStatus",
)({
  name: Schema.String,
  bytes: Schema.Number,
  rows: Schema.Number,
  source: Schema.Literals(["r2", "http", "cache"]),
  fetchMs: Schema.Number,
}) {}

export class DatasetStatus extends Schema.Class<DatasetStatus>("DatasetStatus")({
  id: Schema.String,
  title: Schema.String,
  prefix: Schema.String,
  files: Schema.Array(DatasetFileStatus),
  totalBytes: Schema.Number,
  totalRows: Schema.Number,
  loadMs: Schema.Number,
  /** Epoch milliseconds; the client owns formatting. */
  loadedAt: Schema.Number,
}) {}

export class EngineStatus extends Schema.Class<EngineStatus>("EngineStatus")({
  version: Schema.String,
  revision: Schema.String,
  initialized: Schema.Boolean,
  initMs: Schema.Number,
  coldStart: Schema.Boolean,
  dataset: Schema.Union([DatasetStatus, Schema.Null]),
}) {}

export class QueryMetrics extends Schema.Class<QueryMetrics>("QueryMetrics")({
  /** Time inside `conn.query`, excluding init and file loading. */
  queryMs: Schema.Number,
  /** End-to-end server time for the request. */
  totalMs: Schema.Number,
  rows: Schema.Number,
  bytes: Schema.Number,
  /** False when this run had to initialize DuckDB or load the dataset. */
  warm: Schema.Boolean,
  initMs: Schema.Number,
  loadMs: Schema.Number,
}) {}

export class QueryRun extends Schema.Class<QueryRun>("QueryRun")({
  id: Schema.String,
  title: Schema.String,
  category: QueryCategory,
  columns: Schema.Array(Schema.String),
  rows: Schema.Array(Schema.Array(Cell)),
  rowCount: Schema.Number,
  truncated: Schema.Boolean,
  metrics: QueryMetrics,
}) {}

export class QueryBenchmark extends Schema.Class<QueryBenchmark>(
  "QueryBenchmark",
)({
  id: Schema.String,
  title: Schema.String,
  category: QueryCategory,
  samples: Schema.Array(Schema.Number),
  minMs: Schema.Number,
  medianMs: Schema.Number,
  meanMs: Schema.Number,
  p95Ms: Schema.Number,
  rows: Schema.Number,
}) {}

export class BenchmarkReport extends Schema.Class<BenchmarkReport>(
  "BenchmarkReport",
)({
  iterations: Schema.Number,
  mode: BenchmarkMode,
  /** Epoch milliseconds; the client owns formatting. */
  startedAt: Schema.Number,
  totalMs: Schema.Number,
  engine: EngineStatus,
  queries: Schema.Array(QueryBenchmark),
}) {}

export class ApiErrorBody extends Schema.Class<ApiErrorBody>("ApiErrorBody")({
  error: Schema.String,
  tag: Schema.String,
}) {}

export class Catalog extends Schema.Class<Catalog>("Catalog")({
  dataset: DatasetDefinition,
  queries: Schema.Array(QueryDefinition),
}) {}

export class QueryRequest extends Schema.Class<QueryRequest>("QueryRequest")({
  id: Schema.String,
  mode: Schema.OptionFromOptionalKey(BenchmarkMode),
}) {}

export class BenchmarkRequest extends Schema.Class<BenchmarkRequest>(
  "BenchmarkRequest",
)({
  iterations: Schema.Int,
  mode: Schema.OptionFromOptionalKey(BenchmarkMode),
  ids: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
}) {}

export class ResetResponse extends Schema.Class<ResetResponse>("ResetResponse")({
  ok: Schema.Boolean,
}) {}
