import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { TPCH } from "./dataset";

/** Coarse grouping used for colour and filtering in the UI. */
export const QueryCategory = Schema.Literals([
  "scan",
  "aggregate",
  "join",
  "window",
  "cte",
  "metadata",
  "quantile",
  "timeseries",
]);
export type QueryCategory = typeof QueryCategory.Type;

/** The catalogue is closed: the HTTP boundary accepts an id, never SQL. */
export const QueryId = Schema.Literals([
  "scan-lineitem",
  "revenue-by-year",
  "top-customers",
  "supplier-balance",
  "price-quantiles",
  "priority-by-month",
  "tpch-q1",
  "parquet-schema",
  "scan-part",
  "part-lineitem-join",
]);
export type QueryId = typeof QueryId.Type;

export class QueryDefinition extends Schema.Class<QueryDefinition>(
  "QueryDefinition",
)({
  id: QueryId,
  title: Schema.NonEmptyString,
  category: QueryCategory,
  description: Schema.String,
  /** Runs against the registered dataset files, never against client input. */
  sql: Schema.NonEmptyString,
  dataset: Schema.NonEmptyString,
}) {}

export const QUERIES: ReadonlyArray<QueryDefinition> = [
  new QueryDefinition({
    id: "scan-lineitem",
    title: "Scan line items",
    category: "scan",
    description:
      "Full scan of the largest table: row count, distinct orders, units and gross revenue.",
    dataset: TPCH.id,
    sql: `SELECT
  count(*) AS line_items,
  count(DISTINCT l_orderkey) AS orders,
  sum(l_quantity) AS units,
  round(sum(l_extendedprice), 2) AS gross_revenue
FROM read_parquet('lineitem.parquet')`,
  }),
  new QueryDefinition({
    id: "revenue-by-year",
    title: "Revenue by ship year",
    category: "aggregate",
    description:
      "Grouped aggregation with a derived date part — the classic first query on any dataset.",
    dataset: TPCH.id,
    sql: `SELECT
  year(l_shipdate) AS ship_year,
  count(*) AS line_items,
  round(sum(l_extendedprice * (1 - l_discount)), 2) AS net_revenue
FROM read_parquet('lineitem.parquet')
GROUP BY ship_year
ORDER BY ship_year`,
  }),
  new QueryDefinition({
    id: "top-customers",
    title: "Top customers by revenue",
    category: "join",
    description:
      "Three-way join across customer, orders and line item, grouped with GROUP BY ALL.",
    dataset: TPCH.id,
    sql: `SELECT
  c.c_custkey AS customer_id,
  c.c_name AS customer,
  c.c_mktsegment AS segment,
  count(*) AS line_items,
  round(sum(l.l_extendedprice * (1 - l_discount)), 2) AS net_revenue
FROM read_parquet('customer.parquet') AS c
JOIN read_parquet('orders.parquet') AS o
  ON o.o_custkey = c.c_custkey
JOIN read_parquet('lineitem.parquet') AS l
  ON l.l_orderkey = o.o_orderkey
GROUP BY ALL
ORDER BY net_revenue DESC
LIMIT 10`,
  }),
  new QueryDefinition({
    id: "supplier-balance",
    title: "Suppliers above average balance",
    category: "cte",
    description:
      "CTE referenced twice: a scalar subquery for the average and a window comparison.",
    dataset: TPCH.id,
    sql: `WITH balances AS (
  SELECT s_suppkey, s_name, s_acctbal
  FROM read_parquet('supplier.parquet')
)
SELECT
  s_name,
  round(s_acctbal, 2) AS account_balance,
  round(s_acctbal - (SELECT avg(s_acctbal) FROM balances), 2) AS vs_average
FROM balances
WHERE s_acctbal > (SELECT avg(s_acctbal) FROM balances)
ORDER BY s_acctbal DESC`,
  }),
  new QueryDefinition({
    id: "price-quantiles",
    title: "Extended price quantiles",
    category: "quantile",
    description:
      "Per-ship-mode quantiles — a good check that the Parquet statistics are being used.",
    dataset: TPCH.id,
    sql: `SELECT
  l_shipmode AS ship_mode,
  count(*) AS line_items,
  round(quantile_cont(l_extendedprice, 0.5), 2) AS p50,
  round(quantile_cont(l_extendedprice, 0.9), 2) AS p90,
  round(quantile_cont(l_extendedprice, 0.99), 2) AS p99
FROM read_parquet('lineitem.parquet')
GROUP BY ship_mode
ORDER BY line_items DESC`,
  }),
  new QueryDefinition({
    id: "priority-by-month",
    title: "Order priority by month",
    category: "timeseries",
    description:
      "Date truncation plus a grouped aggregate — the shape most dashboards ask for.",
    dataset: TPCH.id,
    sql: `SELECT
  strftime(o_orderdate, '%Y-%m') AS month,
  o_orderpriority AS priority,
  count(*) AS orders,
  round(sum(o_totalprice), 2) AS total_value
FROM read_parquet('orders.parquet')
GROUP BY ALL
ORDER BY month, priority`,
  }),
  new QueryDefinition({
    id: "tpch-q1",
    title: "TPC-H Q1 pricing summary",
    category: "aggregate",
    description:
      "The canonical TPC-H Q1: filtered scan, six aggregates, grouped by return status.",
    dataset: TPCH.id,
    sql: `SELECT
  l_returnflag,
  l_linestatus,
  sum(l_quantity) AS sum_qty,
  round(sum(l_extendedprice), 2) AS sum_base_price,
  round(sum(l_extendedprice * (1 - l_discount)), 2) AS sum_disc_price,
  round(avg(l_discount), 4) AS avg_discount,
  count(*) AS count_order
FROM read_parquet('lineitem.parquet')
WHERE l_shipdate <= DATE '1998-09-02'
GROUP BY ALL
ORDER BY l_returnflag, l_linestatus`,
  }),
  new QueryDefinition({
    id: "parquet-schema",
    title: "Line item Parquet schema",
    category: "metadata",
    description:
      "DESCRIBE over the largest file — metadata only, no row scan.",
    dataset: TPCH.id,
    sql: `DESCRIBE SELECT * FROM read_parquet('lineitem.parquet')`,
  }),
  new QueryDefinition({
    id: "part-lineitem-join",
    title: "Part × line item join",
    category: "join",
    description:
      "The join behind the window query, without the ranking — isolates join cost from window cost.",
    dataset: TPCH.id,
    sql: `SELECT
  count(*) AS pairs,
  round(sum(l.l_extendedprice * (1 - l_discount)), 2) AS net_revenue
FROM read_parquet('part.parquet') AS p
JOIN read_parquet('lineitem.parquet') AS l
  ON l.l_partkey = p.p_partkey`,
  }),
  new QueryDefinition({
    id: "scan-part",
    title: "Scan the parts catalogue",
    category: "scan",
    description:
      "The smallest table on its own — isolates a single-file read from the join.",
    dataset: TPCH.id,
    sql: `SELECT
  count(*) AS parts,
  round(sum(p_retailprice), 2) AS retail_value,
  round(avg(p_size), 2) AS avg_size
FROM read_parquet('part.parquet')`,
  }),
];

export const findQuery = (id: string): Option.Option<QueryDefinition> =>
  Option.fromNullishOr(QUERIES.find((query) => query.id === id));
