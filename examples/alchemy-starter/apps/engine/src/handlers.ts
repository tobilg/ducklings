import { Match } from "effect";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  BenchmarkMode,
  BenchmarkRequest,
  Catalog,
  QueryRequest,
  ResetResponse,
} from "@ducklings/alchemy-shared/contract";
import { TPCH } from "@ducklings/alchemy-shared/dataset";
import { QUERIES } from "@ducklings/alchemy-shared/queries";
import { Engine, EngineLive } from "./engine";
import { InvalidRequest, type ApiError } from "./errors";
import type { Env } from "./env";

const MAX_ITERATIONS = 20;

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

/** Read a JSON request body and run it through a concrete schema decoder,
 *  collapsing every failure into one 400 at the transport boundary. */
const readBody = <A>(
  request: Request,
  decode: (text: string) => Effect.Effect<A, Schema.SchemaError>,
): Effect.Effect<A, InvalidRequest> =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => request.text(),
      catch: () => new InvalidRequest({ message: "body could not be read" }),
    });
    return yield* decode(text).pipe(
      Effect.mapError(
        () =>
          new InvalidRequest({
            message: "body did not match the endpoint schema",
          }),
      ),
    );
  });

const modeOf = (mode: Option.Option<BenchmarkMode>): BenchmarkMode =>
  Option.getOrElse(mode, (): BenchmarkMode => "warm");

/** Typed failures → transport codes, once, for every endpoint. */
const respond = (
  effect: Effect.Effect<unknown, ApiError>,
): Effect.Effect<Response> =>
  effect.pipe(
    Effect.map((body) => json(body)),
    Effect.catchTags({
      InvalidRequest: (error) =>
        Effect.succeed(json({ error: error.message, tag: error._tag }, 400)),
      UnknownQuery: (error) =>
        Effect.succeed(
          json({ error: `unknown query: ${error.id}`, tag: error._tag }, 404),
        ),
      EngineInitError: (error) =>
        Effect.succeed(json({ error: error.message, tag: error._tag }, 503)),
      DatasetLoadError: (error) =>
        Effect.succeed(json({ error: error.message, tag: error._tag }, 503)),
      QueryFailed: (error) =>
        Effect.succeed(json({ error: error.message, tag: error._tag }, 500)),
    }),
    Effect.catchCause(() =>
      Effect.succeed(json({ error: "internal error", tag: "Defect" }, 500)),
    ),
  );

const status = (env: Env) =>
  Effect.gen(function* () {
    const engine = yield* Engine;
    return yield* engine.status;
  }).pipe(Effect.provide(EngineLive(env)));

const catalog = () =>
  json(new Catalog({ dataset: TPCH, queries: QUERIES }));

const runQuery = (request: Request, env: Env) =>
  Effect.gen(function* () {
    const body = yield* readBody(
      request,
      Schema.decodeUnknownEffect(Schema.fromJsonString(QueryRequest)),
    );
    const engine = yield* Engine;
    return yield* engine.run(body.id, modeOf(body.mode));
  }).pipe(
    Effect.provide(EngineLive(env)),
    Effect.provide(FetchHttpClient.layer),
  );

const benchmark = (request: Request, env: Env) =>
  Effect.gen(function* () {
    const body = yield* readBody(
      request,
      Schema.decodeUnknownEffect(Schema.fromJsonString(BenchmarkRequest)),
    );
    if (body.iterations < 1 || body.iterations > MAX_ITERATIONS) {
      return yield* Effect.fail(
        new InvalidRequest({
          message: `iterations must be 1..${MAX_ITERATIONS}`,
        }),
      );
    }
    const engine = yield* Engine;
    return yield* engine.benchmark({
      iterations: body.iterations,
      mode: modeOf(body.mode),
      ids: body.ids,
    });
  }).pipe(
    Effect.provide(EngineLive(env)),
    Effect.provide(FetchHttpClient.layer),
  );

const reset = (env: Env) =>
  Effect.gen(function* () {
    const engine = yield* Engine;
    yield* engine.reset;
    return new ResetResponse({ ok: true });
  }).pipe(Effect.provide(EngineLive(env)));

/** One router, matched exhaustively; anything else is a 404. */
export const dispatch = (request: Request, env: Env): Effect.Effect<Response> =>
  Effect.suspend(() => {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;

    return Match.value(route).pipe(
      Match.when("GET /api/status", () => respond(status(env))),
      Match.when("GET /api/catalog", () =>
        Effect.succeed(catalog()),
      ),
      Match.when("POST /api/query", () => respond(runQuery(request, env))),
      Match.when("POST /api/benchmark", () =>
        respond(benchmark(request, env)),
      ),
      Match.when("POST /api/reset", () => respond(reset(env))),
      Match.orElse(() =>
        Effect.succeed(json({ error: "not found", tag: "NotFound" }, 404)),
      ),
    );
  });

export const handleRequest = (
  request: Request,
  env: Env,
): Promise<Response> => Effect.runPromise(dispatch(request, env));
