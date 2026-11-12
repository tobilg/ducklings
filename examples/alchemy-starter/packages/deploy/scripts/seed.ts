/**
 * Upload the TPC-H SF 0.01 Parquet files to R2.
 *
 *   bun run seed
 *
 * The Worker reads the same keys through its R2 binding. Without a seeded
 * bucket the Worker falls back to the public shell.duckdb.org mirror, so the
 * lab still runs on a fresh checkout.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as P from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { TPCH, type DatasetFile } from "@ducklings/alchemy-shared/dataset";

class SeedError extends Schema.TaggedError<SeedError>()("SeedError", {
  message: Schema.String,
}) {}

/** CLI boundary: `--check` reads the config without touching R2. */
const checkOnly = process.argv.includes("--check");

const messageOf = (cause: unknown): string =>
  P.isObject(cause) && "message" in cause && P.isString(cause.message)
    ? cause.message
    : "unknown error";

const formatBytes = (value: number): string =>
  value < 1024
    ? `${value} B`
    : value < 1024 * 1024
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / (1024 * 1024)).toFixed(2)} MB`;

const collectBytes = (chunks: ReadonlyArray<Uint8Array>): Uint8Array =>
  Arr.reduce(
    chunks,
    new Uint8Array(0),
    (acc, chunk) => {
      const next = new Uint8Array(acc.length + chunk.length);
      next.set(acc);
      next.set(chunk, acc.length);
      return next;
    },
  );

const download = (
  file: DatasetFile,
): Effect.Effect<Uint8Array, SeedError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* HttpClient.get(file.url).pipe(
      Effect.mapError(
        (cause) => new SeedError({ message: `${file.url}: ${cause.message}` }),
      ),
    );
    const ok = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.mapError(
        (cause) =>
          new SeedError({
            message: `${file.url} answered ${String(cause.response?.status ?? "unknown")}`,
          }),
      ),
    );
    const chunks = yield* HttpClientResponse.stream(Effect.succeed(ok)).pipe(
      Stream.runFold(
        (): ReadonlyArray<Uint8Array> => [],
        (acc, chunk) => [...acc, chunk],
      ),
      Effect.mapError(
        (cause) => new SeedError({ message: `${file.url}: ${cause.message}` }),
      ),
    );
    return collectBytes(chunks);
  });

const upload = (
  client: S3Client,
  bucket: string,
  prefix: string,
  file: DatasetFile,
): Effect.Effect<number, SeedError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    const body = yield* download(file);
    yield* Effect.tryPromise({
      try: () =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `${prefix}/${file.file}`,
            Body: body,
            ContentType: "application/vnd.apache.parquet",
          }),
        ),
      catch: (cause) =>
        new SeedError({
          message: `uploading ${file.file} failed: ${messageOf(cause)}`,
        }),
    });
    const elapsed = (yield* Clock.currentTimeMillis) - started;
    yield* Console.log(
      `  ${file.file.padEnd(20)} ${formatBytes(body.byteLength).padStart(10)}  ${elapsed} ms`,
    );
    return body.byteLength;
  });

const program = Effect.gen(function* () {
  const endpoint = yield* Config.String("R2_ACCESS_KEY_ENDPOINT");
  const accessKeyId = Redacted.value(
    yield* Config.Redacted("R2_ACCESS_KEY_ID"),
  );
  const secretAccessKey = Redacted.value(
    yield* Config.Redacted("R2_ACCESS_KEY_SECRET"),
  );
  const bucket = yield* Config.String("BUCKET_NAME").pipe(
    Config.withDefault("ducklings-alchemy-datasets"),
  );
  const prefix = yield* Config.String("DATASET_PREFIX").pipe(
    Config.withDefault("datasets/tpch/0_01"),
  );

  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  if (checkOnly) {
    yield* Console.log(
      `config ok: r2://${bucket}/${prefix}/ (${TPCH.files.length} files)`,
    );
    return;
  }

  yield* Console.log(`seeding ${TPCH.title} -> r2://${bucket}/${prefix}/`);
  const sizes = yield* Effect.forEach(
    TPCH.files,
    (file) => upload(client, bucket, prefix, file),
    { concurrency: 1 },
  );
  const total = Arr.reduce(sizes, 0, (sum, size) => sum + size);
  yield* Console.log(
    `done: ${TPCH.files.length} objects, ${formatBytes(total)} total`,
  );
});

BunRuntime.runMain(
  program.pipe(
    Effect.provide(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer)),
  ),
);
