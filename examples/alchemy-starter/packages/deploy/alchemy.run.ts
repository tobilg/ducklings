import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

/**
 * The dataset bucket. The seed script uploads TPC-H Parquet objects under
 * `DATASET_PREFIX`; the engine reads them through its R2 binding.
 *
 * Pinned (rather than derived) because the seed script and the deploy have to
 * agree on the physical name without either one reading the other's state.
 */
const BUCKET_NAME = Config.String("BUCKET_NAME").pipe(
  Config.withDefault("ducklings-alchemy-datasets"),
);

/** Where the seed script writes and the engine looks. */
const DATASET_PREFIX = Config.String("DATASET_PREFIX").pipe(
  Config.withDefault("datasets/tpch/0_01"),
);

const DATASET_SOURCE = Config.Literals(["auto", "r2", "http"]).pipe(
  Config.withDefault("auto"),
);

/**
 * State backend is chosen before the stack effect runs, so it is read at the
 * CLI boundary rather than through `Config` inside the effect.
 */
const useState = Effect.runSync(
  Config.Literals(["local", "cloudflare"]).pipe(
    Config.withDefault("local"),
    Effect.map((value) => value === "cloudflare"),
  ),
);

export default Alchemy.Stack(
  "ducklings-alchemy",
  {
    providers: Cloudflare.providers(),
    // Local state keeps a fresh checkout deployable without bootstrapping the
    // shared Cloudflare state store. Set ALCHEMY_STATE=cloudflare to use it.
    state: useState ? Cloudflare.state() : Alchemy.localState(),
  },
  Effect.gen(function* () {
    const bucketName = yield* BUCKET_NAME;
    const datasetPrefix = yield* DATASET_PREFIX;
    const datasetSource = yield* DATASET_SOURCE;

    const bucket = yield* Cloudflare.R2.Bucket("Datasets", {
      name: bucketName,
    });

    // The engine is prebundled by apps/engine/scripts/bundle.mjs: one ESM
    // entry plus `duckdb-workers.wasm`. `bundle: false` is what makes Alchemy
    // upload the pair as-is and turn the `.wasm` import into a
    // `WebAssembly.Module` — re-bundling drops the sibling module.
    const engine = yield* Cloudflare.Worker("Engine", {
      name: "ducklings-alchemy-engine",
      main: "../../apps/engine/dist/worker.js",
      bundle: false,
      compatibility: {},
      // Internal-only: the web Worker reaches it over the service binding.
      workersDev: false,
      dev: { port: 5182, strictPort: true },
      env: {
        BUCKET: bucket,
        DATASET_PREFIX: datasetPrefix,
        DATASET_SOURCE: datasetSource,
      },
    });

    // The web Worker is only a proxy: `/api/*` is forwarded to `ENGINE`, and
    // everything else is served from the static asset layer. The SPA never
    // loads DuckDB itself, so its bundle stays small.
    const site = yield* Cloudflare.Website.Vite("BenchmarkLab", {
      name: "ducklings-alchemy",
      rootDir: "../../apps/web",
      main: "worker/index.ts",
      dev: { port: 5180, strictPort: true },
      assets: {
        notFoundHandling: "single-page-application",
        runWorkerFirst: ["/api/*"],
      },
      workersDev: true,
      env: {
        ENGINE: engine,
      },
    });

    return {
      url: site.url,
      engine: engine.url,
      bucket: bucketName,
      datasetPrefix,
    };
  }),
);
