// Bundles the engine Worker into a self-contained ESM entry with the DuckDB
// WASM beside it — the same shape as the braven analytics engine.
//
// Why a build step at all: `@ducklings/workers/wasm` is a 50 MB `.wasm` import,
// and the Workers bundlers only turn that into a `WebAssembly.Module` when the
// file is a sibling module resolved through `rules` — which Alchemy applies
// only with `bundle: false`. So we pre-bundle the JS glue here, leave exactly
// one relative `.wasm` import for the platform to compile, and let Alchemy
// upload the pair as-is.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const wasmSource = require.resolve("@ducklings/workers/wasm");
if (!existsSync(wasmSource)) {
  throw new Error(`DuckDB WASM not found at ${wasmSource}`);
}

// `@uwdata/flechette` is `@ducklings/workers`'s own dependency, and under an
// isolated linker it can live outside this package's tree. Resolve it from the
// Emscripten glue beside the wasm, then point esbuild at it explicitly.
const glueSource = join(dirname(wasmSource), "duckdb-workers.js");
if (!existsSync(glueSource)) {
  throw new Error(`DuckDB Emscripten glue not found at ${glueSource}`);
}
const ducklingsRequire = createRequire(glueSource);
const flechetteSource = ducklingsRequire.resolve("@uwdata/flechette");

const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });
copyFileSync(wasmSource, join(outDir, "duckdb-workers.wasm"));

await build({
  absWorkingDir: root,
  entryPoints: ["src/worker.ts"],
  outfile: "dist/worker.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  // The WASM stays a sibling module: the platform compiles it (see the Worker's
  // rules), so it must not be inlined or rewritten by esbuild. The Emscripten
  // glue needs no alias — the package imports it relatively from beside its own
  // wasm — so only our own `@ducklings/workers/wasm` import needs rewriting.
  alias: {
    "@ducklings/workers/wasm": "./duckdb-workers.wasm",
    "@uwdata/flechette": flechetteSource,
  },
  external: ["./duckdb-workers.wasm", "cloudflare:workers"],
  logLevel: "info",
});

console.log("bundled apps/engine/dist/worker.js (+ duckdb-workers.wasm)");
