import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Schema from "effect/Schema";

import {
  ApiErrorBody,
  BenchmarkMode,
  EngineStatus,
  QueryRun,
  ResetResponse,
} from "@ducklings/alchemy-shared/contract";

/** A transport or wire failure the UI can show without a stack trace. */
export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  message: Schema.String,
  status: Schema.Int,
  kind: Schema.String,
}) {}

const transport = (cause: { readonly message: string }): ApiError =>
  new ApiError({ message: cause.message, status: 0, kind: "Transport" });

const decodeFailure = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<ApiError> =>
  HttpClientResponse.schemaBodyJson(ApiErrorBody)(response).pipe(
    Effect.map(
      (body) =>
        new ApiError({
          message: body.error,
          status: response.status,
          kind: body.tag,
        }),
    ),
    Effect.orElseSucceed(
      () =>
        new ApiError({
          message: `HTTP ${response.status}`,
          status: response.status,
          kind: "HttpError",
        }),
    ),
  );

const execute = <A, I>(
  request: HttpClientRequest.HttpClientRequest,
  schema: Schema.Codec<A, I>,
): Effect.Effect<A, ApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError(transport),
    );
    if (response.status >= 400) {
      return yield* Effect.fail(yield* decodeFailure(response));
    }
    return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.mapError(
        () =>
          new ApiError({
            message: "response did not match the wire schema",
            status: response.status,
            kind: "Decode",
          }),
      ),
    );
  }).pipe(
    // A hung query must surface as an error, not an endless spinner.
    Effect.timeoutOrElse({
      duration: Duration.seconds(45),
      orElse: () =>
        Effect.fail(
          new ApiError({
            message: "request timed out after 45s",
            status: 0,
            kind: "Timeout",
          }),
        ),
    }),
  );

const get = <A, I>(
  path: string,
  schema: Schema.Codec<A, I>,
): Effect.Effect<A, ApiError, HttpClient.HttpClient> =>
  execute(HttpClientRequest.get(path), schema);

const post = <A, I, B, BI>(
  path: string,
  body: B,
  bodySchema: Schema.Codec<B, BI>,
  responseSchema: Schema.Codec<A, I>,
): Effect.Effect<A, ApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const text = yield* Schema.encodeEffect(
      Schema.fromJsonString(bodySchema),
    )(body).pipe(
      Effect.mapError(
        () =>
          new ApiError({
            message: "request body did not encode",
            status: 0,
            kind: "Encode",
          }),
      ),
    );
    return yield* execute(
      HttpClientRequest.bodyText(
        HttpClientRequest.post(path),
        text,
        "application/json",
      ),
      responseSchema,
    );
  });

const QueryBody = Schema.Struct({
  id: Schema.String,
  mode: BenchmarkMode,
});

export const getStatus: Effect.Effect<
  EngineStatus,
  ApiError,
  HttpClient.HttpClient
> = get("/api/status", EngineStatus);

export const runQuery = (
  id: string,
  mode: BenchmarkMode,
): Effect.Effect<QueryRun, ApiError, HttpClient.HttpClient> =>
  post("/api/query", { id, mode }, QueryBody, QueryRun);

export const resetEngine: Effect.Effect<
  ResetResponse,
  ApiError,
  HttpClient.HttpClient
> = post("/api/reset", {}, Schema.Struct({}), ResetResponse);
