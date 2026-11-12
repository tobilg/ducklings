import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef } from "react";

import { BenchmarkControls } from "@/components/benchmark-controls";
import { LatencyChart, SampleTimeline } from "@/components/charts";
import { DatasetCard } from "@/components/dataset-card";
import { Header } from "@/components/header";
import { QueryCatalog } from "@/components/query-catalog";
import { ResultsPanel } from "@/components/results-panel";
import { StatTiles } from "@/components/stat-tiles";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DEFAULT_QUERY_ID,
  benchmarkAtom,
  coldRunAtom,
  iterationsAtom,
  lastRunAtom,
  queryAtom,
  reportAtom,
  resetAtom,
  selectedQueryAtom,
  statusAtom,
  type TimedRun,
} from "@/lib/atoms";
import { formatMs, formatTime } from "@/lib/format";
import type { BenchmarkReport } from "@ducklings/alchemy-shared/contract";
import { QUERIES } from "@ducklings/alchemy-shared/queries";

const messageOf = (value: unknown): string =>
  P.isObject(value) && "message" in value && P.isString(value.message)
    ? value.message
    : "unknown error";

const errorOf = (result: AsyncResult.AsyncResult<unknown, unknown>): string | null =>
  AsyncResult.isFailure(result) ? messageOf(Cause.squash(result.cause)) : null;

export default function App() {
  const [iterations, setIterations] = useAtom(iterationsAtom);
  const [selectedId, setSelectedId] = useAtom(selectedQueryAtom);

  const reportOption = useAtomValue(reportAtom);
  const lastRunOption = useAtomValue(lastRunAtom);
  const coldRunOption = useAtomValue(coldRunAtom);

  const report: BenchmarkReport | null = Option.getOrElse(
    reportOption,
    () => null,
  );
  const lastRun: TimedRun | null = Option.getOrElse(
    lastRunOption,
    () => null,
  );
  const coldRun: TimedRun | null = Option.getOrElse(
    coldRunOption,
    () => null,
  );

  const statusResult = useAtomValue(statusAtom);
  const status =
    report?.engine ??
    (AsyncResult.isSuccess(statusResult) ? statusResult.value : null);
  const refreshStatus = useAtomRefresh(statusAtom);

  const queryResult = useAtomValue(queryAtom);
  const benchmarkResult = useAtomValue(benchmarkAtom);
  const resetResult = useAtomValue(resetAtom);

  const runQuery = useAtomSet(queryAtom);
  const runBenchmark = useAtomSet(benchmarkAtom);
  const reset = useAtomSet(resetAtom, { mode: "promise" });

  // On first paint: one cold query (DuckDB init + Parquet load + scan), then a
  // warm benchmark. The Worker serializes them, so the cold run lands first.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    runQuery({ id: DEFAULT_QUERY_ID, mode: "cold" });
  }, [runQuery]);

  const handleRun = (id: string) => {
    setSelectedId(id);
    runQuery({ id, mode: "cold" });
  };

  const error =
    errorOf(benchmarkResult) ??
    errorOf(queryResult) ??
    errorOf(resetResult) ??
    errorOf(statusResult);

  const dataset = report?.engine.dataset ?? status?.dataset ?? null;

  return (
    <div className="lab-grid min-h-screen">
      <Header
        status={status}
        onRefresh={refreshStatus}
        refreshing={statusResult.waiting}
      />

      <main className="mx-auto max-w-[1600px] space-y-3 px-4 py-4">
        <StatTiles report={report} coldRun={coldRun} status={status} />

        <div className="grid gap-3 xl:grid-cols-12">
          <div className="space-y-3 xl:col-span-3">
            <BenchmarkControls
              iterations={iterations}
              onIterationsChange={setIterations}
              onRun={() => runBenchmark({ iterations, mode: "cold" })}
              running={benchmarkResult.waiting}
              onReset={() => {
                void reset().then(() => refreshStatus());
              }}
              resetting={resetResult.waiting}
              error={error}
            />
            <DatasetCard dataset={dataset} />
            {report ? (
              <Card className="py-3">
                <CardHeader className="gap-1">
                  <CardTitle className="text-xs">Last benchmark</CardTitle>
                  <CardDescription>
                    {report.mode} · {report.iterations} iterations ·{" "}
                    {formatTime(report.startedAt)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-[11px] text-muted-foreground">
                  {report.queries.length} queries in{" "}
                  {formatMs(report.totalMs)}. The timeline uses the selected
                  query; the bars show each query's median.
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="space-y-3 xl:col-span-6">
            <Card>
              <CardHeader>
                <CardTitle>Median latency by query</CardTitle>
                <CardDescription>
                  Browser round-trips, sorted fastest first. Colour is the
                  query category.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LatencyChart report={report} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sample timeline</CardTitle>
                <CardDescription>
                  One point per iteration for the selected catalogue entry —
                  the shape that tells you whether a number is stable.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SampleTimeline report={report} selectedId={selectedId} />
              </CardContent>
            </Card>

            <ResultsPanel
              run={lastRun?.run ?? null}
              clientMs={lastRun?.clientMs ?? null}
              loading={queryResult.waiting}
            />
          </div>

          <div className="space-y-3 xl:col-span-3">
            <QueryCatalog
              queries={QUERIES}
              report={report}
              selectedId={selectedId}
              runningId={queryResult.waiting ? selectedId : null}
              onSelect={setSelectedId}
              onRun={handleRun}
            />
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          <span>
            TPC-H SF 0.01 · {dataset?.files.length ?? 8} Parquet objects · read
            through the Worker's R2 binding
          </span>
          <span className="font-mono">
            {report
              ? `${report.queries.length} queries · ${report.iterations} iterations`
              : "awaiting first run"}
          </span>
        </footer>
      </main>
    </div>
  );
}
