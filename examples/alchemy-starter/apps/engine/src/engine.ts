import { DuckDB, init, version, type Connection } from "@ducklings/workers";
import wasmModule from "@ducklings/workers/wasm";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Stream from "effect/Stream";

import type {
  BenchmarkMode,
  BenchmarkReport,
  Cell,
  DatasetFileStatus,
  DatasetStatus,
  EngineStatus,
  QueryBenchmark,
  QueryRun,
} from "@ducklings/alchemy-shared/contract";
import {
  BenchmarkReport as BenchmarkReportSchema,
  DatasetFileStatus as DatasetFileStatusSchema,
  DatasetStatus as DatasetStatusSchema,
  EngineStatus as EngineStatusSchema,
  QueryBenchmark as QueryBenchmarkSchema,
  QueryMetrics as QueryMetricsSchema,
  QueryRun as QueryRunSchema,
} from "@ducklings/alchemy-shared/contract";
import { TPCH } from "@ducklings/alchemy-shared/dataset";
import {
  QUERIES,
  findQuery,
  type QueryDefinition,
  type QueryId,
} from "@ducklings/alchemy-shared/queries";
import type { Env } from "./env";
import {
  DatasetLoadError,
  EngineInitError,
  QueryFailed,
  UnknownQuery,
  type EngineError,
} from "./errors";

/** A result set is capped so a query cannot stream the whole dataset back. */
const MAX_ROWS = 200;

/** Concurrent Parquet reads for one request — enough to hide R2 latency,
 *  few enough that the query's objects do not all sit in the heap at once. */
const LOAD_CONCURRENCY = 4;

/** DuckDB's default memory ceiling is the isolate's; leave headroom for JS. */
const MEMORY_LIMIT = "100MB";

/** Bump to force a fresh isolate on the next deploy. */
const ENGINE_REVISION = "2026-11-13.3";

export type RunMode = BenchmarkMode;

export interface BenchmarkOptions {
  readonly iterations: number;
  readonly mode: RunMode;
  readonly ids: Option.Option<readonly string[]>;
}

interface Runtime {
  readonly db: DuckDB;
  readonly conn: Connection;
  readonly initMs: number;
  /** Files registered into this database. */
  readonly registered: Set<string>;
}

/**
 * The database is reused inside an isolate, but files are registered on
 * demand: a query only pays for the Parquet it reads, and bytes survive across
 * requests. `reset` closes the database and clears both caches.
 */
let runtime: Option.Option<Runtime> = Option.none();
let lastDataset: Option.Option<DatasetStatus> = Option.none();
let initialized = false;

/** Parquet bytes survive across requests; a fresh database does not. */
const bytesCache = new Map<
  string,
  { readonly bytes: Uint8Array; readonly source: "r2" | "http" }
>();

/** The union of files this isolate has loaded, for the dataset card. */
const loadedFiles = new Map<string, DatasetFileStatus>();

const messageOf = (cause: unknown): string =>
  P.isObject(cause) && "message" in cause && P.isString(cause.message)
    ? cause.message
    : "unknown error";

const round = (value: number): number => Math.round(value * 100) / 100;

/** Workers freeze `Date.now()` for the request; durations must be monotonic. */
const nanosToMs = (nanos: bigint): number => Number(nanos) / 1_000_000;

const toCell = (value: unknown): Cell => {
  if (value === null || value === undefined) return null;
  if (P.isString(value) || P.isNumber(value) || P.isBoolean(value)) {
    return value;
  }
  if (P.isBigInt(value)) return value.toString();
  if (value instanceof Date) return value.toISOString();
  return "…";
};

const approxCellBytes = (cell: Cell): number =>
  cell === null ? 4 : P.isString(cell) ? cell.length : 8;

const percentile = (sorted: readonly number[], fraction: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
};

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

interface LoadedBytes {
  readonly bytes: Uint8Array;
  readonly source: "r2" | "http" | "cache";
}

/** Concatenate the response body's chunks without assuming a Node `Buffer`. */
const collectBytes = (chunks: Iterable<Uint8Array>): Uint8Array =>
  Arr.reduce(Arr.fromIterable(chunks), new Uint8Array(0), (acc, chunk) => {
    const next = new Uint8Array(acc.length + chunk.length);
    next.set(acc);
    next.set(chunk, acc.length);
    return next;
  });

const loadFile = (
  env: Env,
  key: string,
  url: string,
): Effect.Effect<LoadedBytes, DatasetLoadError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const cached = bytesCache.get(key);
    if (cached) {
      return { bytes: cached.bytes, source: "cache" };
    }

    const requested = env.DATASET_SOURCE ?? "auto";
    const bucket = env.BUCKET;

    if (requested !== "http" && bucket) {
      const object = yield* Effect.tryPromise({
        try: () => bucket.get(key),
        catch: (cause) =>
          new DatasetLoadError({
            message: `R2 read failed for ${key}: ${messageOf(cause)}`,
          }),
      });
      if (object) {
        const bytes = yield* Effect.tryPromise({
          try: () => object.arrayBuffer(),
          catch: (cause) =>
            new DatasetLoadError({
              message: `R2 body failed for ${key}: ${messageOf(cause)}`,
            }),
        });
        const entry = {
          bytes: new Uint8Array(bytes),
          source: "r2" as const,
        };
        bytesCache.set(key, entry);
        return entry;
      }
      if (requested === "r2") {
        return yield* Effect.fail(
          new DatasetLoadError({ message: `R2 object not found: ${key}` }),
        );
      }
    }

    const response = yield* HttpClient.get(url).pipe(
      Effect.mapError(
        (cause) =>
          new DatasetLoadError({
            message: `fetch failed for ${url}: ${cause.message}`,
          }),
      ),
    );
    const ok = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.mapError(
        (cause) =>
          new DatasetLoadError({
            message: `${url} answered ${String(cause.response?.status ?? "unknown")}`,
          }),
      ),
    );
    const chunks = yield* HttpClientResponse.stream(Effect.succeed(ok)).pipe(
      Stream.runFold(
        (): ReadonlyArray<Uint8Array> => [],
        (acc, chunk) => [...acc, chunk],
      ),
      Effect.mapError(
        (cause) =>
          new DatasetLoadError({
            message: `body failed for ${url}: ${cause.message}`,
          }),
      ),
    );
    const entry = { bytes: collectBytes(chunks), source: "http" as const };
    bytesCache.set(key, entry);
    return entry;
  });

const createRuntime = (
  env: Env,
): Effect.Effect<Runtime, EngineInitError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const initStarted = yield* Clock.monotonicTimeNanos;

    yield* Effect.tryPromise({
      try: () => init({ wasmModule }),
      catch: (cause) =>
        new EngineInitError({
          message: `DuckDB init failed: ${messageOf(cause)}`,
        }),
    });
    yield* Effect.sync(() => {
      initialized = true;
    });

    const db = yield* Effect.try({
      try: () =>
        new DuckDB({
          lockConfiguration: true,
          customConfig: {
            memory_limit: MEMORY_LIMIT,
            preserve_insertion_order: "false",
          },
        }),
      catch: (cause) =>
        new EngineInitError({
          message: `database open failed: ${messageOf(cause)}`,
        }),
    });
    const conn = yield* Effect.try({
      try: () => db.connect(),
      catch: (cause) =>
        new EngineInitError({
          message: `connection failed: ${messageOf(cause)}`,
        }),
    });
    const initMs = round(
      nanosToMs((yield* Clock.monotonicTimeNanos) - initStarted),
    );

    return { db, conn, initMs, registered: new Set() };
  });

const ensureRuntime = (
  env: Env,
): Effect.Effect<Runtime, EngineInitError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const existing = runtime;
    if (Option.isSome(existing)) return existing.value;
    const created = yield* createRuntime(env);
    runtime = Option.some(created);
    return created;
  });

interface FileLoad {
  readonly loadMs: number;
  /** Files that had to be fetched from R2 / the mirror this request. */
  readonly fetched: number;
}

/** Register only the files the query reads and this database lacks. */
const ensureFiles = (
  env: Env,
  rt: Runtime,
  names: ReadonlyArray<string>,
): Effect.Effect<FileLoad, DatasetLoadError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const missing = Arr.filter(names, (name) => !rt.registered.has(name));
    if (missing.length === 0) return { loadMs: 0, fetched: 0 };

    const prefix = env.DATASET_PREFIX ?? "datasets/tpch/0_01";
    const loadStarted = yield* Clock.monotonicTimeNanos;
    const loaded = yield* Effect.forEach(
      missing,
      (name) =>
        Effect.gen(function* () {
          const file = yield* Option.match(
            Arr.findFirst(TPCH.files, (candidate) => candidate.name === name),
            {
              onNone: () =>
                Effect.fail(
                  new DatasetLoadError({
                    message: `unknown dataset file: ${name}`,
                  }),
                ),
              onSome: (found) => Effect.succeed(found),
            },
          );
          const started = yield* Clock.monotonicTimeNanos;
          const entry = yield* loadFile(
            env,
            `${prefix}/${file.file}`,
            file.url,
          );
          // Emscripten's FS may retain the buffer, so hand it a copy:
          // the cached bytes must survive for the next request.
          yield* Effect.tryPromise({
            try: () =>
              rt.db.registerFileBuffer(file.name, new Uint8Array(entry.bytes)),
            catch: (cause) =>
              new DatasetLoadError({
                message: `registering ${file.name} failed: ${messageOf(cause)}`,
              }),
          });
          rt.registered.add(file.name);
          const status = new DatasetFileStatusSchema({
            name: file.name,
            bytes: entry.bytes.byteLength,
            rows: file.rows,
            source: entry.source,
            fetchMs: round(
              nanosToMs((yield* Clock.monotonicTimeNanos) - started),
            ),
          });
          loadedFiles.set(status.name, status);
          return { source: entry.source };
        }),
      { concurrency: LOAD_CONCURRENCY },
    );

    const loadMs = round(
      nanosToMs((yield* Clock.monotonicTimeNanos) - loadStarted),
    );
    const loadedAt = yield* Clock.currentTimeMillis;
    const statusFiles = Arr.fromIterable(loadedFiles.values());
    lastDataset = Option.some(
      new DatasetStatusSchema({
        id: TPCH.id,
        title: TPCH.title,
        prefix,
        files: statusFiles,
        totalBytes: Arr.reduce(
          statusFiles,
          0,
          (total, file) => total + file.bytes,
        ),
        totalRows: Arr.reduce(
          statusFiles,
          0,
          (total, file) => total + file.rows,
        ),
        loadMs,
        loadedAt,
      }),
    );

    return {
      loadMs,
      fetched: Arr.reduce(
        loaded,
        0,
        (count, entry) => (entry.source === "cache" ? count : count + 1),
      ),
    };
  });

const resetRuntime = Effect.sync(() => {
  Option.match(runtime, {
    onNone: () => undefined,
    onSome: (current) => {
      current.conn.close();
      current.db.close();
      runtime = Option.none();
    },
  });
  lastDataset = Option.none();
  loadedFiles.clear();
  bytesCache.clear();
});

const runQuery = (
  env: Env,
  id: string,
  _mode: RunMode,
): Effect.Effect<QueryRun, EngineError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const query = yield* Option.match(findQuery(id), {
      onNone: () => Effect.fail(new UnknownQuery({ id })),
      onSome: (found: QueryDefinition) => Effect.succeed(found),
    });

    const startedAt = yield* Clock.monotonicTimeNanos;
    const wasRunning = Option.isSome(runtime);
    const rt = yield* ensureRuntime(env);
    const loaded = yield* ensureFiles(env, rt, query.files);

    const queryStarted = yield* Clock.monotonicTimeNanos;
    const rawRows = yield* Effect.tryPromise({
      try: () => rt.conn.query<Record<string, unknown>>(query.sql),
      catch: (cause) => new QueryFailed({ id, message: messageOf(cause) }),
    });
    const queryMs = round(
      nanosToMs((yield* Clock.monotonicTimeNanos) - queryStarted),
    );
    const totalMs = round(
      nanosToMs((yield* Clock.monotonicTimeNanos) - startedAt),
    );

    const columns = Option.getOrElse(
      Arr.head(rawRows).pipe(Option.map(R.keys)),
      (): readonly string[] => [],
    );
    const rows = Arr.map(Arr.take(rawRows, MAX_ROWS), (row) =>
      Arr.map(columns, (column) => toCell(row[column])),
    );
    const bytes = Arr.reduce(
      rows,
      0,
      (total, row) =>
        total + Arr.reduce(row, 0, (sum, cell) => sum + approxCellBytes(cell)),
    );

    return new QueryRunSchema({
      id: query.id,
      title: query.title,
      category: query.category,
      columns,
      rows,
      rowCount: rawRows.length,
      truncated: rawRows.length > MAX_ROWS,
      metrics: new QueryMetricsSchema({
        queryMs,
        totalMs,
        rows: rawRows.length,
        bytes,
        warm: wasRunning && loaded.fetched === 0,
        initMs: wasRunning ? 0 : rt.initMs,
        loadMs: loaded.loadMs,
      }),
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(25),
      orElse: () =>
        Effect.fail(
          new QueryFailed({ id, message: "query timed out after 25s" }),
        ),
    }),
  );

const engineStatus = (): EngineStatus =>
  new EngineStatusSchema({
    version: initialized ? version() : "not-initialized",
    revision: ENGINE_REVISION,
    initialized,
    initMs: 0,
    coldStart: Option.isNone(lastDataset),
    dataset: Option.getOrElse(lastDataset, () => null),
  });

const benchmark = (
  env: Env,
  options: BenchmarkOptions,
): Effect.Effect<BenchmarkReport, EngineError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const benchmarkStarted = yield* Clock.monotonicTimeNanos;
    const startedAt = yield* Clock.currentTimeMillis;
    const selected = Option.match(options.ids, {
      onNone: (): readonly QueryDefinition[] => QUERIES,
      onSome: (ids) =>
        Arr.filter(QUERIES, (query) =>
          Arr.some(ids, (id) => id === query.id),
        ),
    });

    const results = yield* Effect.forEach(
      selected,
      (query) =>
        Effect.gen(function* () {
          const runs = yield* Effect.forEach(
            Arr.range(1, options.iterations),
            () => runQuery(env, query.id, options.mode),
            { concurrency: 1 },
          );
          const samples = Arr.map(runs, (run) => run.metrics.queryMs);
          const sorted = Arr.sort(samples, Order.Number);
          const rows = Option.getOrElse(
            Arr.last(runs).pipe(Option.map((run) => run.metrics.rows)),
            () => 0,
          );
          return new QueryBenchmarkSchema({
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

    const engine: EngineStatus = engineStatus();

    return new BenchmarkReportSchema({
      iterations: options.iterations,
      mode: options.mode,
      startedAt,
      totalMs: round(nanosToMs((yield* Clock.monotonicTimeNanos) - benchmarkStarted)),
      engine,
      queries: results,
    });
  });

const status: Effect.Effect<EngineStatus> = Effect.sync(engineStatus);


export class Engine extends Context.Service<
  Engine,
  {
    readonly status: Effect.Effect<EngineStatus>;
    readonly run: (
      id: QueryId | string,
      mode: RunMode,
    ) => Effect.Effect<QueryRun, EngineError, HttpClient.HttpClient>;
    readonly benchmark: (
      options: BenchmarkOptions,
    ) => Effect.Effect<BenchmarkReport, EngineError, HttpClient.HttpClient>;
    readonly reset: Effect.Effect<void>;
  }
>()("DucklingsEngine") {}

export const EngineLive = (env: Env) =>
  Layer.succeed(
    Engine,
    Engine.of({
      status,
      run: (id, mode) => runQuery(env, id, mode),
      benchmark: (options) => benchmark(env, options),
      reset: resetRuntime,
    }),
  );
