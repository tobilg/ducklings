# Ducklings · Alchemy Benchmark Lab

A small, dense web app for measuring DuckDB WASM over Parquet in R2. It exists
to answer one question with numbers instead of vibes:

> How long does a cold request take, how long does a warm one take, and where
> does the time go?

The stack mirrors the shape of a production analytics Worker, split the way
Braven splits it:

| Layer | Choice |
| --- | --- |
| Engine | Cloudflare Worker running `@ducklings/workers` (DuckDB WASM, httpfs + Parquet) |
| Storage | R2 bucket with TPC-H SF 0.01 Parquet objects |
| Server | Effect 4 — `Context.Service`, `Layer`, `Schema`, `Schema.TaggedError`, `Effect.fn` |
| Client | Vite + React 19 + Tailwind v4 + shadcn components |
| Client state | Effect Atom (`effect/reactivity`, `@effect/atom-react`) |
| Client HTTP | Effect `HttpClient` + `Schema` response decoding |
| Charts | TanStack Charts (`barX`, `lineY`) |
| Deploy | Alchemy v2 (`Cloudflare.R2.Bucket`, `Cloudflare.Worker`, `Cloudflare.Website.Vite`) |
| Scripts | Effect programs on `@effect/platform-bun` |
| Package manager | Bun |

Two Workers, not one:

- **Engine** (`apps/engine`) — the DuckDB Worker. `apps/engine/scripts/bundle.mjs`
  pre-bundles it with esbuild and leaves exactly one sibling `.wasm` import;
  Alchemy uploads it with `bundle: false` so the platform turns that import into
  a `WebAssembly.Module`. This is the same build shape as Braven's analytics
  engine.
- **Web** (`apps/web`) — a Vite SPA plus a tiny Worker that forwards `/api/*`
  to the engine over an `ENGINE` service binding and serves everything else from
  the static asset layer.

## What it measures

Cloudflare freezes the Worker clock during CPU-only execution, so a
server-side `Date.now()` / `performance.now()` around a synchronous DuckDB call
reports `0`. The lab therefore measures the metric that survives production:

- **Client round-trip** — the browser's monotonic clock around one
  `/api/query` fetch. This includes network, the web proxy, the engine, and
  DuckDB, and is what the charts and the benchmark run use.
- **Cold round-trip** — the first query after a reset, including dataset load.
- **Server `loadMs`** — Parquet fetch + `registerFileBuffer`; this spans async
  R2 reads, so it advances even in a Worker.
- **Server `initMs` / `queryMs`** — useful locally; `0` in production because
  the clock is frozen.

`bun run bench` still drives the server-side `POST /api/benchmark` endpoint for
local and CLI comparisons. The dashboard's **Run benchmark** is browser-driven:
it issues one `/api/query` per sample and times it in the browser.

## Run it

```bash
cd examples/alchemy-starter
cp .env.example .env          # or copy ~/Documents/Sudo/sudokw/.env
bun install

bun run deploy                # Alchemy creates the R2 bucket + both Workers
bun run seed                  # upload TPC-H Parquet to the alchemy-created bucket
bun run dev                   # Alchemy dev, http://localhost:5180
```

`bun run dev` builds the engine bundle, then starts `alchemy dev`: the engine
Worker in workerd, the web Worker, and the Vite dev server. Local R2 starts
empty, so the engine falls back to `shell.duckdb.org` until you seed it.

The first query initializes DuckDB and loads the dataset; the dashboard then
runs a browser-timed benchmark automatically.

For UI-only iteration with HMR:

```bash
bun run --filter @ducklings/alchemy-web dev:ui   # Vite on 5183, proxies /api to 5180
```

## Compare two builds

`bun run bench` resets the engine, runs the whole catalogue through
`/api/benchmark`, prints a table, and writes a JSON report under
`bench-results/`:

```bash
bun run bench -- --iterations 5 --mode warm
bun run bench -- --url https://ducklings-alchemy.example.workers.dev --mode cold
```

The report is the input for the next phase. The CLI drives the server-side
`/api/benchmark` endpoint, so its per-query samples are meaningful **locally**;
in production the Worker clock is frozen and the dashboard's browser-driven
benchmark is the number to compare. Feed either case to
[strobe](https://github.com/anomalyco/strobe) as a `base`/`head` pair, or diff
two JSON files:

```bash
bun add -d @hona/strobe
bunx strobe init
```

Strobe runs alternating pairs on CPUs of their own and reports a confidence
interval, which is what turns "this looks faster" into a verdict.

## Deploy

```bash
bun run deploy
```

State defaults to `Alchemy.localState()` (`.alchemy/`, gitignored) so a fresh
checkout deploys without a bootstrap step. Set `ALCHEMY_STATE=cloudflare` to
use the shared Cloudflare state store instead — bootstrap it once with
`alchemy provider cloudflare bootstrap --profile <profile>`.

Alchemy provisions:

- `Cloudflare.R2.Bucket("Datasets")` — pinned to `ducklings-alchemy-datasets`
  (override with `BUCKET_NAME`)
- `Cloudflare.Worker("Engine")` — `apps/engine/dist/worker.js` with
  `bundle: false`, the R2 binding, and the dataset prefix
- `Cloudflare.Website.Vite("BenchmarkLab")` — the SPA + proxy Worker with the
  `ENGINE` service binding

`assets.runWorkerFirst: ["/api/*"]` routes only the API through the web Worker.
Every other path is served by Cloudflare's static asset layer.

## The query catalogue

Ten fixed statements in `packages/shared/src/queries.ts`:

| Query | Shape |
| --- | --- |
| `scan-lineitem` | full scan, distinct count, sum |
| `revenue-by-year` | grouped aggregate with `year()` |
| `top-customers` | three-way join + `GROUP BY ALL` |
| `part-lineitem-join` | the join behind the window query, isolated |
| `supplier-balance` | CTE referenced twice, scalar subquery |
| `price-quantiles` | `quantile_cont` per ship mode |
| `priority-by-month` | date truncation + grouped aggregate |
| `tpch-q1` | the canonical TPC-H Q1 |
| `parquet-schema` | `DESCRIBE` — metadata only |
| `scan-part` | single-file read, the smallest table |

The HTTP boundary accepts a query **id**, never SQL. The engine only executes
statements compiled in the catalogue.

## R2 vs the public mirror

`DATASET_SOURCE` controls where the engine reads Parquet:

- `auto` (default) — try R2, fall back to `shell.duckdb.org`
- `r2` — fail if the object is missing
- `http` — always use the public mirror

The fallback is what lets a fresh checkout run before `bun run seed`. In a
deployed stack, seed the bucket and the `DatasetCard` will show `r2` badges.

## Benchmarking a local Ducklings build

The example consumes `@ducklings/workers` from npm so it runs on a fresh
checkout. To measure a local build:

```bash
# from the repository root
make duckdb-workers       # compile the Workers WASM (~long)
make typescript-workers   # build packages/ducklings-workers

# point the engine at it
cd examples/alchemy-starter
bun add --cwd apps/engine file:../../../packages/ducklings-workers
```

Then `bun run build` and `bun run deploy`. Keep a note of which build produced a
benchmark run — the point of the lab is comparing builds, not just queries.

## Layout

```
examples/alchemy-starter/
├── apps/
│   ├── engine/                # DuckDB Worker
│   │   ├── src/worker.ts      # entry
│   │   ├── src/engine.ts      # DuckDB singleton, R2 loader, stats
│   │   ├── src/handlers.ts    # schema-decoded routes, typed errors → HTTP
│   │   └── scripts/bundle.mjs # esbuild prebundle + wasm sibling
│   └── web/
│       ├── worker/index.ts    # /api/* → ENGINE service binding
│       └── src/               # React dashboard, shadcn, Effect Atom, charts
├── packages/
│   ├── shared/                # dataset, catalogue, wire schemas
│   └── deploy/                # Alchemy stack + seed/bench Effect programs
└── .env.example
```

## Notes

- Each request gets its own DuckDB database and connection, then closes them.
  The WASM module is initialized once per isolate; database creation and Parquet
  registration are per request, matching Braven's engine and keeping heap state
  from accumulating across benchmark runs.
- Requests are not serialized. A query that never resolves is bounded by a 25s
  engine timeout and the browser's 45s timeout, so one bad query cannot block
  the rest of the catalogue.
- `init()` is module-global, so a request pays database creation and Parquet
  loading but not the WASM compile after the first request in an isolate.
  `POST /api/reset` clears the remembered dataset.
- The result set is capped at 200 rows (`MAX_ROWS` in `engine.ts`); the metric
  is the round-trip, not the transfer.
