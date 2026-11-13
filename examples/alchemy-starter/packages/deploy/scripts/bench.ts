/**
 * Drive the running lab's benchmark endpoint and write a diffable report.
 *
 *   bun run bench                         # http://127.0.0.1:5180, warm, 5 iterations
 *   bun run bench -- --mode cold --iterations 3
 *   bun run bench -- --url https://ducklings-alchemy.example.workers.dev
 *
 * The JSON report is the input for the next phase: compare two builds with
 * strobe (`bunx @hona/strobe run --base ... --head ...`) or diff the files.
 *
 * This drives the server-side `/api/benchmark` endpoint, so its per-query
 * samples are meaningful locally. In production Cloudflare freezes the Worker
 * clock during CPU-only execution; use the dashboard's browser-driven
 * benchmark for the deployed number.
 */
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  BenchmarkMode,
  BenchmarkReport,
  ResetResponse,
} from "@ducklings/alchemy-shared/contract";

class BenchError extends Schema.TaggedError<BenchError>()("BenchError", {
  message: Schema.String,
}) {}

class BenchmarkBody extends Schema.Class<BenchmarkBody>("BenchmarkBody")({
  iterations: Schema.Int,
  mode: BenchmarkMode,
}) {}

const parseArgs = (): ReadonlyMap<string, string> => {
  const args = process.argv.slice(2);
  const pairs = Arr.filterMap(
    Arr.range(0, Math.max(0, args.length - 1)),
    (index) => {
      const value = args[index];
      if (value === undefined || !value.startsWith("--")) {
        return Result.failVoid;
      }
      return Result.succeed([
        value.slice(2),
        args[index + 1] ?? "",
      ] as const);
    },
  );
  return new Map(pairs);
};

const request = <A, I>(
  request: HttpClientRequest.HttpClientRequest,
  schema: Schema.Codec<A, I>,
): Effect.Effect<A, BenchError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError((cause) => new BenchError({ message: cause.message })),
    );
    if (response.status >= 400) {
      return yield* Effect.fail(
        new BenchError({ message: `HTTP ${response.status}` }),
      );
    }
    return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.mapError(
        () => new BenchError({ message: "response did not match the schema" }),
      ),
    );
  });

const formatMs = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(1)} ms`;

const pad = (value: string, width: number): string =>
  value.length >= width ? value : value + " ".repeat(width - value.length);

const program = Effect.gen(function* () {
  const base = (yield* Config.String("url")).replace(/\/$/, "");
  const mode = yield* Config.Literals(["warm", "cold"]).pipe(
    Config.withDefault("warm"),
  );
  const iterations = yield* Config.Int("iterations").pipe(
    Config.withDefault(5),
  );
  const outDir = yield* Config.String("out").pipe(
    Config.withDefault("bench-results"),
  );

  // Drop the isolate's database so the cold start in the report is real.
  yield* request(HttpClientRequest.post(`${base}/api/reset`), ResetResponse);

  const body = yield* Schema.encodeEffect(
    Schema.fromJsonString(BenchmarkBody),
  )(new BenchmarkBody({ iterations, mode })).pipe(
    Effect.mapError(
      () => new BenchError({ message: "benchmark body did not encode" }),
    ),
  );
  const report = yield* request(
    HttpClientRequest.bodyText(
      HttpClientRequest.post(`${base}/api/benchmark`),
      body,
      "application/json",
    ),
    BenchmarkReport,
  );

  const stamp = DateTime.formatIso(
    DateTime.makeUnsafe(yield* Clock.currentTimeMillis),
  ).replace(/[:.]/g, "-");
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const outPath = path.join(
    outDir,
    `${stamp}-${report.mode}-${report.iterations}x.json`,
  );
  yield* fs.makeDirectory(outDir, { recursive: true });
  const encoded = yield* Schema.encodeEffect(
    Schema.fromJsonString(BenchmarkReport, { space: 2 }),
  )(report).pipe(
    Effect.mapError(
      () => new BenchError({ message: "report did not encode" }),
    ),
  );
  yield* fs.writeFileString(outPath, `${encoded}\n`);

  yield* Console.log(
    `${report.mode} · ${report.iterations} iterations · ${report.queries.length} queries · ${formatMs(report.totalMs)} total`,
  );
  if (report.engine.dataset) {
    yield* Console.log(
      `dataset ${(report.engine.dataset.totalBytes / (1024 * 1024)).toFixed(2)} MB · ${report.engine.dataset.totalRows} rows · init ${formatMs(report.engine.initMs)}`,
    );
  }
  yield* Console.log("");
  yield* Console.log(
    `${pad("query", 30)} ${pad("median", 10)} ${pad("p95", 10)} ${pad("min", 10)} samples`,
  );
  yield* Effect.forEach(
    report.queries,
    (query) =>
      Console.log(
        `${pad(query.id, 30)} ${pad(formatMs(query.medianMs), 10)} ${pad(formatMs(query.p95Ms), 10)} ${pad(formatMs(query.minMs), 10)} ${query.samples.map((value) => value.toFixed(1)).join(", ")}`,
      ),
    { concurrency: 1 },
  );
  yield* Console.log("");
  yield* Console.log(`wrote ${outPath}`);
  if (process.env.STROBE === "1") {
    yield* Console.log(`strobe:metric bench_total_ms=${report.totalMs}`);
    yield* Console.log(
      `strobe:metric fastest_median_ms=${Math.min(...report.queries.map((query) => query.medianMs))}`,
    );
  }
});

BunRuntime.runMain(
  program.pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          url: parseArgs().get("url") ?? "http://127.0.0.1:5180",
          mode: parseArgs().get("mode") ?? "warm",
          iterations: parseArgs().get("iterations") ?? "5",
          out: parseArgs().get("out") ?? "bench-results",
        }),
      ),
    ),
    Effect.provide(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer)),
  ),
);
