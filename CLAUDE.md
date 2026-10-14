# Ducklings

A minimal DuckDB WASM build for browsers and Cloudflare Workers.

## Goals

- Minimal footprint/size without sacrificing essential features
- TypeScript API for JavaScript/TypeScript access
- Remote data loading via httpfs extension
- Use Flechette instead of apache-arrow for JS/Arrow bridging
- First-class Cloudflare Workers support

## Packages

The project publishes five npm packages:

| Package | Description | API Style |
|---------|-------------|-----------|
| `@ducklings/browser` | Browser version | Sync |
| `@ducklings/workers` | Default Cloudflare Workers package with httpfs and Parquet | Async (Promises) |
| `@ducklings/workers-iceberg` | Workers with httpfs, Parquet, Avro, and Iceberg | Async (Promises) |
| `@ducklings/workers-ducklake` | Cloudflare Workers version with DuckLake | Async (Promises) |
| `@ducklings/workers-spatial` | Cloudflare Workers version with Spatial, GEOS, and PROJ | Async (Promises) |

`@ducklings/workers` and `@ducklings/workers-iceberg` are separate published packages. Keep generic examples on `@ducklings/workers` and Iceberg-specific examples on `@ducklings/workers-iceberg`. Both use the shared Workers API, but their native artifacts differ: `dist/duckdb-workers.{js,wasm}` bundles only httpfs and Parquet, and `dist/duckdb-workers-iceberg.{js,wasm}` additionally bundles Avro and Iceberg. Keep the build targets, package copy steps, and Vite plugin resolution separate. Never substitute one artifact for the other.

**Why separate browser and Workers packages?** Cloudflare Workers doesn't support synchronous XMLHttpRequest. The workers package uses Emscripten's Asyncify to enable async `fetch()` calls, making httpfs work properly.

## Project Structure

```
ducklings/
├── Makefile                       # Build orchestration
├── deps/                          # Git submodules
│   ├── duckdb/                    # DuckDB version pinned in Makefile (C++ source)
│   ├── duckdb-httpfs/             # httpfs extension source
│   ├── duckdb-iceberg/            # Iceberg extension source
│   ├── duckdb-avro/               # Avro extension source (iceberg dependency)
│   └── ducklake/                  # DuckLake extension source
├── dist/                          # WASM build output
│   ├── duckdb.js                  # Browser JS glue
│   ├── duckdb.wasm                # Browser WASM binary
│   ├── duckdb-workers.js          # Base Workers JS glue (Asyncify)
│   ├── duckdb-workers.wasm        # Base Workers WASM (httpfs + Parquet)
│   ├── duckdb-workers-iceberg.js  # Iceberg Workers JS glue
│   ├── duckdb-workers-iceberg.wasm # Iceberg Workers WASM binary
│   ├── duckdb-workers-ducklake.js # DuckLake Workers JS glue (Asyncify)
│   └── duckdb-workers-ducklake.wasm # DuckLake Workers WASM binary
├── vcpkg.json                     # vcpkg manifest (iceberg/avro C deps)
├── vcpkg_ports/                   # vcpkg overlay ports for WASM compat
│   ├── aws-c-io/                  # No-op I/O for WASM
│   ├── liblzma/                   # LITTLE_ENDIAN fix for wasm32
│   ├── snappy/                    # fPIC fix for wasm32
│   └── zlib/                      # Build fixes
├── patches/                       # Source patches for dependencies
│   └── duckdb/                    # DuckDB-specific patches
│       └── preloaded_extensions.patch # Makes DuckDB recognize static extensions as preloaded
├── packages/
│   ├── ducklings-browser/         # @ducklings/browser (npm)
│   ├── ducklings-workers/         # @ducklings/workers (npm; default)
│   ├── ducklings-workers-iceberg/ # @ducklings/workers-iceberg (npm)
│   ├── ducklings-workers-ducklake/ # @ducklings/workers-ducklake (npm)
│   ├── example-browser/           # Browser example (private)
│   └── example-cloudflare-worker/ # CF Workers example (private)
├── scripts/
│   └── build-duckdb.sh            # Emscripten build script
└── .github/workflows/
    ├── ci.yml                     # CI (build, test on PR/push)
    └── release.yml                # Release (npm publish on tag)
```

## Build System

### Prerequisites

- Node.js 18+
- pnpm 9+
- Emscripten SDK 4.0.22
- Binaryen (for wasm-opt)
- git (for vcpkg clone during build)

### Make Targets

```bash
# Full build
make all                  # Build browser WASM + TypeScript package

# WASM compilation (requires Emscripten)
make duckdb-browser       # Compile browser WASM (~2 min)
make duckdb-workers       # Compile httpfs/Parquet workers WASM with Asyncify
make duckdb-workers-iceberg # Compile workers WASM with Avro and Iceberg
make duckdb-workers-ducklake # Compile DuckLake workers WASM with Asyncify
make duckdb-all           # Build browser, base Workers, Iceberg, and DuckLake WASM

# TypeScript packages
make typescript-browser   # Build @ducklings/browser package
make typescript-workers   # Build @ducklings/workers package
make typescript-workers-iceberg # Build @ducklings/workers-iceberg package
make typescript-workers-ducklake # Build @ducklings/workers-ducklake package
make typescript-all       # Build browser, base Workers, Iceberg, and DuckLake packages

# Utilities
make deps                 # Initialize git submodules
make clean                # Clean build artifacts
```

### Build Flow

1. `make duckdb-browser` compiles DuckDB C++ to WASM using Emscripten
2. Output goes to `dist/duckdb.js` and `dist/duckdb.wasm`
3. `make typescript-browser` builds the npm package
4. Package build copies WASM files to `packages/ducklings-browser/dist/wasm/`

Same flow for workers variant with Asyncify enabled.

### Deployment size checks

- Cloudflare Workers allows **64 MiB uncompressed** on both Free and Paid plans. There is **no compressed-size limit** (verified 2026-10-14 against the [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#worker-size)).
- Build the Worker example, then run `bash scripts/check-worker-size.sh <example-package-directory>`. Check Wrangler's `Total Upload` against 65,536 KiB; gzip is informational unless `DUCKLINGS_WORKER_GZIP_LIMIT_KIB` explicitly sets a project budget. `DUCKLINGS_WORKER_TOTAL_LIMIT_KIB` overrides the uncompressed budget.
- Browser WASM hosted as a static asset must still fit the separate **25 MiB per-file limit**. Preserve the browser asset checks in CI and release workflows.
- Recheck the linked platform documentation before changing limits or adding size-specific optimizations. Bundle size alone does not require a Paid plan; CPU and other runtime limits still differ by plan.

### Workers runtime limits

Checked against the [general Workers limits](https://developers.cloudflare.com/workers/platform/limits/) on 2026-10-14:

- Memory is 128 MB **per isolate**, shared by JavaScript, WASM, and concurrent requests, on both plans. The build's `MAXIMUM_MEMORY=128MB` only caps WASM linear memory. The examples' DuckDB `memory_limit: '100MB'` is an application budget, not a cap on total isolate usage; HTTP buffers and query results also consume memory.
- HTTP CPU time is 10 ms on Free; Paid defaults to 30 seconds and can be configured up to 300,000 ms. Network waits do not count as CPU. HTTP wall-clock duration has no hard limit while the client stays connected; `waitUntil()` extends work by up to 30 seconds after response/disconnection.
- Top-level startup has a 1-second limit. Keep DuckDB initialization inside the request handler and reuse the initialized instance.
- External subrequests are 50 per invocation on Free and 10,000 by default on Paid (configurable up to 10 million). Redirects count individually. Internal-service requests have a 1,000 limit on Free; on Paid they share the configured limit.
- The six-connection limit applies to connections waiting for response headers, plus outbound WebSockets. Receiving headers releases an HTTP connection's slot; do not interpret it as a cap of six open response bodies.
- Request body limits depend on the Cloudflare account plan (100 MB Free/Pro, 200 MB Business, up to 5 GB Enterprise), not the Workers plan. There is no platform response-body cap, but buffering remains constrained by isolate memory.
- Free permits 100,000 requests/day; Paid has no daily request cap. Environment variables and secrets allow 64 entries on Free / 128 on Paid, 5 KB each. Do not infer that a bundle fitting on Free means its DuckDB workload fits Free CPU or subrequest quotas.

## Key Files

### TypeScript API

- `packages/ducklings-browser/src/index.ts` - Browser API (sync)
- `packages/ducklings-workers-shared/src/index.ts` - Shared Workers API implementation
- `packages/ducklings-workers/src/index.ts` - @ducklings/workers package entry
- `packages/ducklings-workers-iceberg/src/index.ts` - @ducklings/workers-iceberg package entry
- `packages/ducklings-workers-ducklake/src/index.ts` - @ducklings/workers-ducklake package entry

Both packages export:
- `init()` - Initialize WASM module
- `DuckDB` - Database class
- `Connection` - Connection with query/execute methods
- `PreparedStatement` - Parameterized queries
- `version()` - Get DuckDB version
- Flechette re-exports: `tableFromArrays`, `tableFromIPC`, `tableToIPC`

### WASM Build

- `scripts/build-duckdb.sh` - Main build script
- Uses Emscripten with -Oz optimization, LTO, wasm-opt
- Extensions built-in: Parquet and httpfs in the base Workers build; Avro/Iceberg, DuckLake, or Spatial are added only in their respective Workers flavors
- Workers build adds `-sASYNCIFY` for async fetch support
- vcpkg provides C/C++ dependencies (AWS SDK, roaring, avro-c, curl, openssl, etc.)

### Patch System

DuckDB source requires patches for WASM compatibility. Patches are stored in `patches/duckdb/` and applied automatically during build.

**Current Patches:**

| Patch | Purpose |
|-------|---------|
| `preloaded_extensions.patch` | Makes DuckDB recognize httpfs, avro, and iceberg as preloaded |
| `http_util_extension_guard.patch` | Guards HTTP client code behind DUCKDB_DISABLE_EXTENSION_LOAD |

**How it works:**
1. Build script calls `apply_patches()` before CMake configuration
2. Patches are applied with `patch -p1` from the DuckDB source directory
3. A marker check prevents re-applying already-applied patches
4. `make clean` resets the submodule to remove patches

**Updating DuckDB version:**
1. Update `DUCKDB_VERSION` in Makefile
2. Run `make clean && make deps`
3. If patches fail to apply, update patch files for new line numbers
4. Run `make duckdb-all` to verify build works

**Creating new patches:**
1. Make changes to `deps/duckdb/` source files
2. Generate patch: `cd deps/duckdb && git diff > ../../patches/duckdb/my_fix.patch`
3. Add patch application to `apply_patches()` in build script
4. Document the patch purpose in this section

## GitHub Actions

### CI Workflow (`.github/workflows/ci.yml`)

Triggers: push to main/feature/*, PR to main

Jobs:
1. `build-wasm` - Compile WASM with caching
2. `build-typescript` - Build npm packages
3. `lint` - Type check both packages

### Release Workflow (`.github/workflows/release.yml`)

Triggers: tag push (`v*`), manual dispatch

Steps:
1. Build WASM (browser, base Workers, Iceberg, DuckLake, and Spatial)
2. Set package versions and build/test TypeScript packages
3. Check Spatial's Worker size and local workerd integration
4. Publish all five packages to npm through trusted publishing (OIDC)
5. Create GitHub release with all five WASM binaries

Publishing jobs require `id-token: write`, npm 11, and a trusted publisher configured on each npm package for `tobilg/ducklings` and `release.yml`, with direct `npm publish` allowed. No `NPM_TOKEN` is used. If Spatial or the additional Iceberg package does not yet exist on npm, publish it once with ordinary npm authentication before configuring OIDC; the dry-run workflow uploads tested default Workers, Iceberg, and Spatial tarballs. See [publishing setup](docs/publishing.md).

## Dependencies

### Git Submodules (deps/)

- `duckdb` - DuckDB v1.5.0 source code
- `duckdb-httpfs` - httpfs extension source
- `duckdb-iceberg` - Iceberg extension source (v1.5-variegata)
- `duckdb-avro` - Avro extension source (dependency of iceberg)

### vcpkg Dependencies

Managed via `vcpkg.json` manifest. Cross-compiled for `wasm32-emscripten` during build.

Key libraries: AWS SDK (SigV4 signing, S3), roaring (bitmap indexes), avro-c, curl, openssl, jansson, snappy, lzma, zlib.

All variants share one `vcpkg_installed/` tree and pick their libraries at link time. Spatial's GEOS, PROJ, SQLite, and Expat come from the same manifest, using the overlay ports in `deps/duckdb-spatial/vcpkg_ports`. GDAL is not built.

Initialize `deps/duckdb-spatial` for every variant. Apply its patches before the shared vcpkg install, including when building the browser first: GEOS and PROJ need exception catching enabled at compilation. Always run `vcpkg install` so its ABI checks rebuild stale dependencies; archive existence alone is not a valid cache check. CI cache keys include the SDK version, overlay ports, and Spatial patches.

Version pins: `VCPKG_BASELINE` in Makefile, `builtin-baseline` in vcpkg.json.

### npm Dependencies

- `@uwdata/flechette` - Arrow IPC encoding/decoding
- `tsup` - TypeScript bundler
- `vitest` - Testing

## API Differences

| Feature | Browser (`@ducklings/browser`) | Base Workers (`@ducklings/workers`) | Workers DuckLake (`@ducklings/workers-ducklake`) |
|---------|------------------------------|----------------------------------------|-----------------------------------------------|
| `init()` | `await init()` or `init(wasmUrl)` | `await init({ wasmModule })` | `await init({ wasmModule })` |
| `query()` | Returns `T[]` (sync) | Returns `Promise<T[]>` (async) | Returns `Promise<T[]>` (async) |
| `execute()` | Returns `number` (sync) | Returns `Promise<number>` (async) | Returns `Promise<number>` (async) |
| `queryArrow()` | Returns `Table` (sync) | Returns `Promise<Table>` (async) | Returns `Promise<Table>` (async) |
| httpfs | Uses XMLHttpRequest | Uses fetch() via Asyncify | Uses fetch() via Asyncify |

## Development Notes

- The workers packages share `packages/ducklings-workers-shared`
- Types are shared between the workers package flavors
- Both packages use pnpm workspaces
- WASM files are copied into each package during build (not shared)
- Example packages use `workspace:*` dependency for local development

## Limitations

### No Dynamic Extension Loading

Runtime extension loading (`INSTALL`/`LOAD` commands) is **disabled**. Only statically compiled extensions are available: base Workers includes Parquet and httpfs; browser/Workers Iceberg builds include Parquet, httpfs, Avro, and Iceberg; the Workers DuckLake build includes Parquet, httpfs, and DuckLake. The published default builds omit JSON.

**Why?** Dynamic extension loading in WASM requires Emscripten's `-sMAIN_MODULE` flag, which significantly increases binary size (~2-3x). This conflicts with the project's goal of minimal footprint.

**What works:**
- `SELECT * FROM 'https://example.com/data.parquet'` (httpfs + Parquet)
- `SELECT * FROM read_json('file.json')` (JSON)
- `SELECT * FROM iceberg_scan('https://example.com/iceberg-table')` (Iceberg)
- `SELECT * FROM iceberg_snapshots('https://example.com/iceberg-table')` (Iceberg metadata)
- `SELECT * FROM read_avro('https://example.com/data.avro')` (Avro)
- All built-in DuckDB functions

**What doesn't work:**
- `INSTALL <ext>` → Error: "Installing external extensions is disabled through a compile time flag"
- `LOAD <ext>` → Error: "Loading external extensions is disabled through a compile time flag"
- Any extension not compiled into the WASM binary
