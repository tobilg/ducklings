import { barX, defineChart, lineY } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import { useMemo } from "react";

import type { BenchmarkReport } from "@ducklings/alchemy-shared/contract";
import type { QueryCategory } from "@ducklings/alchemy-shared/queries";

const CATEGORY_COLORS: Record<QueryCategory, string> = {
  scan: "var(--chart-1)",
  aggregate: "var(--chart-2)",
  join: "var(--chart-3)",
  window: "var(--chart-4)",
  cte: "var(--chart-5)",
  metadata: "oklch(0.7 0.02 240)",
  quantile: "oklch(0.74 0.16 145)",
  timeseries: "oklch(0.72 0.18 320)",
};

interface LatencyRow {
  readonly id: string;
  readonly label: string;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly category: QueryCategory;
}

const EmptyChart = ({ message }: { readonly message: string }) => (
  <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-border/70 text-xs text-muted-foreground">
    {message}
  </div>
);

export function LatencyChart({
  report,
}: {
  readonly report: BenchmarkReport | null;
}) {
  const rows = useMemo((): readonly LatencyRow[] => {
    if (!report) return [];
    const mapped = Arr.map(report.queries, (query) => ({
      id: query.id,
      label: query.title,
      medianMs: query.medianMs,
      p95Ms: query.p95Ms,
      category: query.category,
    }));
    return Arr.sort(
      mapped,
      Order.mapInput(Order.Number, (row: LatencyRow) => row.medianMs),
    );
  }, [report]);

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barX(rows, {
            x: "medianMs",
            y: "label",
            fill: (row: LatencyRow) => CATEGORY_COLORS[row.category],
            radius: { end: 4 },
          }),
        ],
        scales: {
          x: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: {
              label: "median ms",
              ticks: { format: (value) => `${value} ms` },
            },
          },
          y: { scale: () => scaleBand().padding(0.22) },
        },
        tooltip,
      }),
    [rows],
  );

  if (rows.length === 0) {
    return <EmptyChart message="Run a benchmark to plot latency" />;
  }

  return (
    <Chart
      definition={definition}
      height={Math.max(260, rows.length * 30)}
      ariaLabel="Median query latency"
      ariaDescription="Horizontal bars of the median execution time for each catalogue query."
    />
  );
}

interface TimelineRow {
  readonly iteration: number;
  readonly ms: number;
  readonly query: string;
  readonly color: string;
}

export function SampleTimeline({
  report,
  selectedId,
}: {
  readonly report: BenchmarkReport | null;
  readonly selectedId: string;
}) {
  const selected = useMemo(
    () =>
      Option.getOrElse(
        Option.fromNullishOr(
          report?.queries.find((query) => query.id === selectedId),
        ),
        () => null,
      ),
    [report, selectedId],
  );

  const rows = useMemo((): readonly TimelineRow[] => {
    if (!selected) return [];
    return Arr.map(selected.samples, (ms, index) => ({
      iteration: index + 1,
      ms,
      query: selected.title,
      color: CATEGORY_COLORS[selected.category],
    }));
  }, [selected]);

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          lineY(rows, {
            x: "iteration",
            y: "ms",
            z: "query",
            stroke: (row: TimelineRow) => row.color,
            points: true,
            strokeWidth: 2,
          }),
        ],
        scales: {
          x: {
            scale: scaleLinear,
            nice: true,
            axis: { label: "iteration", ticks: { format: (v) => `${v}` } },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: {
              label: "ms",
              ticks: { format: (value) => `${value} ms` },
            },
          },
        },
        tooltip,
      }),
    [rows],
  );

  if (rows.length === 0) {
    return <EmptyChart message="Pick a query to see its samples" />;
  }

  return (
    <Chart
      definition={definition}
      height={320}
      ariaLabel={`Sample timeline for ${selected?.title ?? "query"}`}
      ariaDescription="Each point is one benchmark iteration; the line connects samples for the selected query."
    />
  );
}
