import type * as React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BenchmarkReport, EngineStatus } from "@ducklings/alchemy-shared/contract";
import type { TimedRun } from "@/lib/atoms";
import { formatBytes, formatMs, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Tile {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly tone?: "default" | "good" | "warn";
}

const toneClass: Record<NonNullable<Tile["tone"]>, string> = {
  default: "text-foreground",
  good: "text-emerald-300",
  warn: "text-amber-300",
};

export function StatTiles({
  report,
  coldRun,
  status,
}: {
  readonly report: BenchmarkReport | null;
  readonly coldRun: TimedRun | null;
  readonly status: EngineStatus | null;
}) {
  const dataset = report?.engine.dataset ?? status?.dataset ?? null;
  const coldStartMs = coldRun
    ? coldRun.run.metrics.initMs + coldRun.run.metrics.loadMs
    : report && dataset
      ? report.engine.initMs + dataset.loadMs
      : null;
  const coldRoundTrip = coldRun?.clientMs ?? null;
  const fastest = report
    ? Math.min(...report.queries.map((query) => query.medianMs))
    : null;
  const slowest = report
    ? Math.max(...report.queries.map((query) => query.p95Ms))
    : null;

  const tiles: readonly Tile[] = [
    {
      label: "Cold round-trip",
      value: coldRoundTrip === null ? "—" : formatMs(coldRoundTrip),
      hint:
        coldStartMs === null
          ? "browser fetch through the engine"
          : `server init ${formatMs(coldRun?.run.metrics.initMs ?? 0)} + load ${formatMs(coldRun?.run.metrics.loadMs ?? 0)}`,
      tone: coldRoundTrip === null ? "default" : "warn",
    },
    {
      label: "Dataset",
      value: dataset ? formatBytes(dataset.totalBytes) : "—",
      hint: dataset
        ? `${formatNumber(dataset.totalRows)} rows · ${dataset.files.length} files`
        : "Parquet objects from R2",
    },
    {
      label: "Fastest median",
      value: fastest === null ? "—" : formatMs(fastest),
      hint: report ? `across ${report.queries.length} catalogue queries` : "run a benchmark",
      tone: "good",
    },
    {
      label: "Slowest p95",
      value: slowest === null ? "—" : formatMs(slowest),
      hint: "tail latency of the slowest query",
    },
    {
      label: "Benchmark",
      value: report ? formatMs(report.totalMs) : "—",
      hint: report
        ? `${report.iterations} iterations · ${report.mode} · browser-timed`
        : "no run yet",
    },
    {
      label: "Engine",
      value: status?.version ?? "—",
      hint: status?.initialized ? "DuckDB WASM ready" : "not initialized yet",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <Card key={tile.label} className="gap-1 py-3">
          <CardHeader className="gap-0.5">
            <CardDescription className="text-[10px] font-medium uppercase tracking-[0.12em]">
              {tile.label}
            </CardDescription>
            <CardTitle
              className={cn(
                "text-xl font-semibold tabular",
                toneClass[tile.tone ?? "default"],
              )}
            >
              {tile.value}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] leading-tight text-muted-foreground">
              {tile.hint}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

