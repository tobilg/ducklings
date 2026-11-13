import * as Schema from "effect/Schema";

/**
 * The dataset the lab benchmarks against. TPC-H at scale factor 0.01 is the
 * canonical DuckDB demo set: five Parquet files, ~79k rows, small enough to
 * load in a Worker but wide enough to exercise scans, joins, windows and
 * Parquet metadata.
 *
 * `name` is the file name registered inside DuckDB (and therefore the name the
 * SQL reads). `file` is the object name under the dataset prefix.
 */
export class DatasetFile extends Schema.Class<DatasetFile>("DatasetFile")({
  name: Schema.NonEmptyString,
  file: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  rows: Schema.Int,
  description: Schema.String,
}) {}

export class DatasetDefinition extends Schema.Class<DatasetDefinition>(
  "DatasetDefinition",
)({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  description: Schema.String,
  files: Schema.NonEmptyArray(DatasetFile),
}) {}

const MIRROR = "https://shell.duckdb.org/data/tpch/0_01/parquet";

const file = (
  name: string,
  rows: number,
  description: string,
): DatasetFile =>
  new DatasetFile({
    name: `${name}.parquet`,
    file: `${name}.parquet`,
    url: `${MIRROR}/${name}.parquet`,
    rows,
    description,
  });

export const TPCH = new DatasetDefinition({
  id: "tpch-sf0.01",
  title: "TPC-H · SF 0.01",
  description:
    "Five TPC-H SF 0.01 tables — the files the catalogue actually queries.",
  files: [
    file("customer", 1_500, "Customers and their market segment"),
    file("lineitem", 60_175, "Order line items — the largest table"),
    file("orders", 15_000, "Order headers"),
    file("part", 2_000, "Parts catalogue"),
    file("supplier", 100, "Suppliers and account balances"),
  ],
});
