import * as Schema from "effect/Schema";

/** DuckDB WASM could not be initialized. */
export class EngineInitError extends Schema.TaggedError<EngineInitError>()(
  "EngineInitError",
  { message: Schema.String },
  { description: "DuckDB WASM failed to initialize." },
) {}

/** The Parquet objects could not be read from R2 or the public mirror. */
export class DatasetLoadError extends Schema.TaggedError<DatasetLoadError>()(
  "DatasetLoadError",
  { message: Schema.String },
  { description: "The benchmark dataset could not be loaded." },
) {}

/** A catalogue query failed inside DuckDB. */
export class QueryFailed extends Schema.TaggedError<QueryFailed>()(
  "QueryFailed",
  { id: Schema.String, message: Schema.String },
  { description: "A benchmark query failed." },
) {}

/** The caller named a query that is not in the fixed catalogue. */
export class UnknownQuery extends Schema.TaggedError<UnknownQuery>()(
  "UnknownQuery",
  { id: Schema.String },
  { description: "The requested query id is not in the catalogue." },
) {}

/** The request body did not match the endpoint's schema. */
export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()(
  "InvalidRequest",
  { message: Schema.String },
  { description: "The request body was invalid." },
) {}

export type EngineError =
  | EngineInitError
  | DatasetLoadError
  | QueryFailed
  | UnknownQuery;

export type ApiError = EngineError | InvalidRequest;
