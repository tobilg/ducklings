import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import { Atom } from "effect/reactivity";

import {
  BenchmarkReport,
  QueryBenchmark,
  type BenchmarkMode,
  type QueryRun,
} from "@ducklings/alchemy-shared/contract";
import { QUERIES } from "@ducklings/alchemy-shared/queries";
import { getStatus, resetEngine, runQuery } from "./api";

const runtime = Atom.runtime(FetchHttpClient.layer);

export const DEFAULT_ITERATIONS = 1;
export const DEFAULT_QUERY_ID = "scan-lineitem";

/** Live engine status; re-read with `useAtomRefresh`. */
export const statusAtom = runtime.atom(getStatus);

/** A query plus the browser-observed round-trip. Cloudflare freezes the
 *  Worker clock during CPU-only execution, so this is the number that is
 *  meaningful in production; `run.metrics.queryMs` is for local runs. */
export interface TimedRun {
  readonly run: QueryRun;
  readonly clientMs: number;
}

/** The last successful benchmark, kept across a waiting run. */
export const reportAtom = Atom.make(Option.none<BenchmarkReport>()).pipe(
  Atom.keepAlive,
);

/** The last successful single query, and the last cold one. */
export const lastRunAtom = Atom.make(Option.none<TimedRun>()).pipe(
  Atom.keepAlive,
);
export const coldRunAtom = Atom.make(Option.none<TimedRun>()).pipe(
  Atom.keepAlive,
);

/** Local UI selections live in atoms too, so components never own state. */
export const iterationsAtom = Atom.make(DEFAULT_ITERATIONS);
export const selectedQueryAtom = Atom.make<string>(DEFAULT_QUERY_ID);

const round = (value: number): number => Math.round(value * 100) / 100;

const timed = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<{ readonly value: A; readonly clientMs: number }, E, R> =>
  Effect.gen(function* () {
    const started = yield* Clock.monotonicTimeNanos;
    const value = yield* effect;
    return {
      value,
      clientMs: round(Number((yield* Clock.monotonicTimeNanos) - started) / 1_000_000),
    };
  });

const medianOf = (sorted: readonly number[]): number => {
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const meanOf = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : Arr.reduce(values, 0, (total, value) => total + value) / values.length;

const percentile = (sorted: readonly number[], fraction: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
};

export const queryAtom = runtime.fn(
  (input: { readonly id: string; readonly mode: BenchmarkMode }) =>
    Effect.gen(function* () {
      const timedRun = yield* timed(runQuery(input.id, input.mode));
      const entry: TimedRun = {
        run: timedRun.value,
        clientMs: timedRun.clientMs,
      };
      yield* Atom.set(lastRunAtom, Option.some(entry));
      if (!entry.run.metrics.warm) {
        yield* Atom.set(coldRunAtom, Option.some(entry));
      }
      yield* Atom.refresh(statusAtom);
      return entry.run;
    }),
);

/**
 * The browser-driven benchmark: one `/api/query` round trip per sample, timed
 * with the browser's monotonic clock. This is the metric that survives
 * Cloudflare's frozen Worker clock.
 */
export const benchmarkAtom = runtime.fn(
  (input: { readonly iterations: number; readonly mode: BenchmarkMode }) =>
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      const started = yield* Clock.monotonicTimeNanos;

      const queries = yield* Effect.forEach(
        QUERIES,
        (query) =>
          Effect.gen(function* () {
            const runs = yield* Effect.forEach(
              Arr.range(1, input.iterations),
              () => timed(runQuery(query.id, input.mode)),
              { concurrency: 1 },
            );
            const samples = Arr.map(runs, (run) => run.clientMs);
            const sorted = Arr.sort(samples, Order.Number);
            const rows = Option.getOrElse(
              Arr.last(runs).pipe(Option.map((run) => run.value.metrics.rows)),
              () => 0,
            );
            return new QueryBenchmark({
              id: query.id,
              title: query.title,
              category: query.category,
              samples,
              minMs: sorted[0] ?? 0,
              medianMs: round(medianOf(sorted)),
              meanMs: round(meanOf(sorted)),
              p95Ms: round(percentile(sorted, 0.95)),
              rows,
            });
          }),
        { concurrency: 1 },
      );

      const report = new BenchmarkReport({
        iterations: input.iterations,
        mode: input.mode,
        startedAt,
        totalMs: round(
          Number((yield* Clock.monotonicTimeNanos) - started) / 1_000_000,
        ),
        engine: yield* getStatus,
        queries,
      });
      yield* Atom.set(reportAtom, Option.some(report));
      yield* Atom.refresh(statusAtom);
      return report;
    }),
);

export const resetAtom = runtime.fn(() =>
  Effect.gen(function* () {
    yield* resetEngine;
    yield* Atom.set(reportAtom, Option.none());
    yield* Atom.set(lastRunAtom, Option.none());
    yield* Atom.set(coldRunAtom, Option.none());
  }),
);
