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
| `@ducklings/browser` | Browser version (DuckDB runs in a Web Worker) | Async (Promises) |
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
│   ├── duckdb-quack/              # Quack client (DuckLake metadata access)
│   ├── duckdb-spatial/            # Spatial extension source + GEOS/PROJ vcpkg ports
│   ├── ducklake/                  # DuckLake extension source
│   └── nanoarrow/                 # Arrow IPC reader for insertArrowFromIPCStream
├── dist/                          # WASM build output
│   ├── duckdb.js                  # Browser JS glue
│   ├── duckdb.wasm                # Browser WASM binary
│   ├── duckdb-workers.js          # Base Workers JS glue (Asyncify)
│   ├── duckdb-workers.wasm        # Base Workers WASM (httpfs + Parquet)
│   ├── duckdb-workers-iceberg.js  # Iceberg Workers JS glue
│   ├── duckdb-workers-iceberg.wasm # Iceberg Workers WASM binary
│   ├── duckdb-workers-ducklake.js # DuckLake Workers JS glue (Asyncify)
│   ├── duckdb-workers-ducklake.wasm # DuckLake Workers WASM binary
│   ├── duckdb-workers-spatial.js  # Spatial Workers JS glue (Asyncify)
│   └── duckdb-workers-spatial.wasm # Spatial Workers WASM binary
├── src/                           # Native glue compiled into every build
│   ├── http/                      # WASM HTTP client (sync XHR in browser, fetch via Asyncify in Workers)
│   └── arrow/                     # Arrow IPC insert via nanoarrow
├── vcpkg.json                     # vcpkg manifest (iceberg/avro C deps)
├── vcpkg_ports/                   # vcpkg overlay ports for WASM compat
│   ├── avro-c/                    # Pins the duckdb-avro-c commit deps/duckdb-avro vendors
│   ├── aws-c-io/                  # No-op I/O for WASM
│   ├── liblzma/                   # LITTLE_ENDIAN fix for wasm32
│   ├── snappy/                    # fPIC fix for wasm32
│   └── zlib/                      # Build fixes
├── patches/                       # Source patches for dependencies, one directory per submodule
│   ├── duckdb/
│   ├── duckdb-quack/
│   └── duckdb-spatial/
├── packages/
│   ├── ducklings-browser/         # @ducklings/browser (npm)
│   ├── ducklings-workers-shared/  # Shared Workers API source (private, not published)
│   ├── ducklings-workers/         # @ducklings/workers (npm; default)
│   ├── ducklings-workers-iceberg/ # @ducklings/workers-iceberg (npm)
│   ├── ducklings-workers-ducklake/ # @ducklings/workers-ducklake (npm)
│   ├── ducklings-workers-spatial/ # @ducklings/workers-spatial (npm)
│   ├── documentation/             # TypeDoc site and guides (private)
│   ├── example-browser/           # Browser example (private)
│   ├── example-cloudflare-worker/ # Base CF Workers example (private)
│   ├── example-cloudflare-worker-iceberg/  # Iceberg CF Workers example (private)
│   ├── example-cloudflare-worker-ducklake/ # DuckLake CF Workers example (private)
│   └── example-cloudflare-worker-spatial/  # Spatial CF Workers example + workerd test (private)
├── scripts/
│   ├── build-duckdb.sh            # Emscripten build script
│   ├── check-worker-size.sh       # Wrangler dry-run upload size check
│   └── test-build-dependencies.py # Tests build-script dependency setup without compiling DuckDB
└── .github/workflows/
    ├── ci.yml                     # CI (build, test on PR/push)
    └── release.yml                # Release (npm publish on tag)
```

## Build System

### Prerequisites

- Node.js 18+
- pnpm 9+
- Emscripten SDK 6.0.13. The build script stops on any other `emcc` version (e.g. Homebrew's), after first activating a project-local SDK in `build/emsdk` if one exists. Override deliberately with `DUCKLINGS_EMSDK_VERSION`. Each build directory records its `emcc` version and starts over when it changes
- Binaryen (for wasm-opt)
- git (for vcpkg clone during build)

### Make Targets

```bash
# Full build
make all                  # Build all WASM variants + all TypeScript packages

# WASM compilation (requires Emscripten)
make duckdb-browser       # Compile browser WASM (~2 min)
make duckdb-workers       # Compile httpfs/Parquet workers WASM with Asyncify
make duckdb-workers-iceberg # Compile workers WASM with Avro and Iceberg
make duckdb-workers-ducklake # Compile DuckLake workers WASM with Asyncify
make duckdb-workers-spatial # Compile Spatial workers WASM (GEOS + PROJ)
make duckdb-workers-all   # Build base, Iceberg, DuckLake, and Spatial Workers WASM
make duckdb-all           # Build browser and all Workers WASM

# TypeScript packages
make typescript-browser   # Build @ducklings/browser package
make typescript-workers   # Build @ducklings/workers package
make typescript-workers-iceberg # Build @ducklings/workers-iceberg package
make typescript-workers-ducklake # Build @ducklings/workers-ducklake package
make typescript-workers-spatial # Build @ducklings/workers-spatial package
make typescript-all       # Build all five npm packages

# Checks
make check-worker-ducklake-size # Wrangler dry-run size check for the DuckLake example
make check-worker-spatial-size  # Wrangler dry-run size check for the Spatial example

# Utilities
make deps                 # Initialize git submodules
make sync-versions        # Set all package versions from DUCKDB_VERSION
make example              # Run the browser example dev server
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

- `packages/ducklings-browser/src/index.ts` - Browser API entry (async; main-thread classes in `src/async/`, Web Worker side in `src/worker/`)
- `packages/ducklings-workers-shared/src/index.ts` - Shared Workers API implementation
- `packages/ducklings-workers/src/index.ts` - @ducklings/workers package entry
- `packages/ducklings-workers-iceberg/src/index.ts` - @ducklings/workers-iceberg package entry
- `packages/ducklings-workers-ducklake/src/index.ts` - @ducklings/workers-ducklake package entry
- `packages/ducklings-workers-spatial/tsup.config.ts` - @ducklings/workers-spatial builds directly from the shared entry (no own `src/index.ts`, no Vite plugin)

All packages export:
- `init()` - Initialize WASM module
- `DuckDB` - Database class
- `Connection` - Connection with query/execute methods
- `PreparedStatement` - Parameterized queries
- `version()` - Get DuckDB version

The Workers packages also re-export Flechette's `tableFromArrays`, `tableFromIPC`, and `tableToIPC`; the browser package re-exports only the `Table` type.

### WASM Build

- `scripts/build-duckdb.sh` - Main build script
- Uses Emscripten with -Oz optimization, LTO, wasm-opt
- Extensions built-in: Parquet and httpfs in the browser and base Workers builds; Avro/Iceberg, DuckLake, or Spatial are added only in their respective Workers flavors. The browser omits Avro and Iceberg to stay under the 25 MiB static-asset limit
- Workers build adds `-sASYNCIFY` for async fetch support
- The browser build uses native Wasm exceptions (`-fwasm-exceptions`, about 18% smaller code) and `-fno-rtti` (exception types keep their typeinfo), and compiles into `build/emscripten-browser`. Workers builds keep Emscripten's JS exceptions (`-sDISABLE_EXCEPTION_CATCHING=0`) because Asyncify cannot instrument native ones. Base, Iceberg, and DuckLake share `build/emscripten` and keep RTTI, because Iceberg, Quack, and DuckLake use `dynamic_cast`. Spatial builds in `build/emscripten-spatial` with `-fno-rtti`. Hand-compiled sources get the same flags through `EXTENSION_CODEGEN_FLAGS`; mismatched flags compile out their catch blocks
- vcpkg provides C/C++ dependencies (AWS SDK, roaring, avro-c, curl, openssl, etc.)

### Patch System

DuckDB and several extension sources require patches for WASM compatibility. Patches are stored in `patches/<submodule>/` and applied automatically during build.

**Current Patches:**

| Patch | Purpose |
|-------|---------|
| `duckdb/preloaded_extensions.patch` | Makes DuckDB recognize the statically linked extensions as preloaded |
| `duckdb/skip_capi_extension_tables.patch` | Stops `DatabaseInstance` from storing the C API v1/v2 extension-table builders, so the linker drops the unused C API v2 and the unexported C API v1 functions; loading a C API extension throws instead |
| `duckdb-quack/client_only_wasm.patch` | Compiles out Quack server code, the httplib+OpenSSL fingerprint-pinned client, and the heartbeat thread under `QUACK_CLIENT_ONLY_WASM` |
| `duckdb-spatial/emscripten-exceptions.patch` | Enables exception catching in the GEOS and PROJ vcpkg ports |
| `duckdb-spatial/optional-gdal.patch` | Makes GDAL optional (`SPATIAL_USE_GDAL=OFF`) |
| `duckdb-spatial/geojson-row-arena.patch` | Copies each GeoJSON result to the string heap and resets the arena per row, bounding memory |
| `duckdb-spatial/register-geojson-without-json.patch` | Registers Spatial's own `ST_AsGeoJSON`/`ST_GeomFromGeoJSON` when the json extension isn't loaded; DuckDB 2.0 moved them to json, which our builds omit |

The DuckDB 2.0 migration dropped the Avro and Iceberg Asyncify close patches, the httpfs S3 content-type patch, and the Spatial `ResetStorage` patch: upstream fixed all four.

**How it works:**
1. Build script calls `apply_patches()` before CMake configuration
2. `apply_patch_series` applies every `*.patch` in `patches/<submodule>/` with `git apply` inside that submodule
3. A `git apply --reverse --check` skips patches that are already applied; a patch that applies neither way fails the build
4. duckdb, httpfs, and Spatial patches apply to every variant (Spatial's vcpkg ports are shared). Avro and Iceberg patches apply only to the iceberg flavor. Quack and DuckLake patches apply only to the ducklake flavor. Only `duckdb/`, `duckdb-quack/`, and `duckdb-spatial/` currently contain patches; missing directories are skipped.
5. `make clean` resets the patched submodules to remove patches

**Updating DuckDB version:**
1. Update `DUCKDB_VERSION` and the extension pins in the Makefile, copying the SHAs from `.github/config/extensions/*.cmake` at the new DuckDB tag
2. Run `make clean && make pin-versions && make sync-versions`; update `vcpkg_ports/avro-c` if the Avro pin moved
3. Check each patch with `git -C deps/<submodule> apply --check`; drop patches upstream has absorbed and regenerate the rest
4. Run `make duckdb-all`, then the package tests and Worker size checks

**Creating new patches:**
1. Make changes to the submodule's source files, e.g. `deps/duckdb/`
2. Generate patch: `cd deps/duckdb && git diff > ../../patches/duckdb/my_fix.patch`. If earlier patches in the series touch the same file, diff only your change against the patched file; patches apply in filename order
3. Patches in an existing `patches/<submodule>/` directory are picked up automatically. For a new submodule, add an `apply_patch_series` call to `apply_patches()` in the build script.
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
3. Fail on a browser WASM over the 25 MiB limit, then check Spatial's Worker size and local workerd integration
4. Publish all five packages to npm through trusted publishing (OIDC)
5. Create GitHub release with all five WASM binaries. The body starts with `docs/releases/v<version>.md` when it exists (highlights and breaking changes), followed by the package/usage template

Publishing jobs require `id-token: write`, npm 11, and a trusted publisher configured on each npm package for `tobilg/ducklings` and `release.yml`, with direct `npm publish` allowed. No `NPM_TOKEN` is used. If Spatial or the additional Iceberg package does not yet exist on npm, publish it once with ordinary npm authentication before configuring OIDC; the dry-run workflow uploads tested default Workers, Iceberg, and Spatial tarballs. See [publishing setup](docs/publishing.md).

## Dependencies

### Git Submodules (deps/)

Refs are pinned in the Makefile (`DUCKDB_*_VERSION`, `NANOARROW_VERSION`); `make pin-versions` checks them out. Extensions are pinned to the exact commits DuckDB itself builds them with (`.github/config/extensions/*.cmake` at the DuckDB tag), not to branch heads. To move to a new DuckDB release, copy those SHAs.

- `duckdb` - DuckDB source code (`DUCKDB_VERSION`, currently v2.0.0)
- `duckdb-httpfs` - httpfs extension source
- `duckdb-iceberg` - Iceberg extension source
- `duckdb-avro` - Avro extension source, dependency of Iceberg. Vendors `avro-c` as the nested submodule `third_party/avro-c`; `pin-versions` initializes it.
- `duckdb-quack` - Quack client used by DuckLake
- `ducklake` - DuckLake extension source
- `duckdb-spatial` - Spatial extension source and GEOS/PROJ vcpkg ports
- `nanoarrow` - Arrow IPC reader (apache-arrow-nanoarrow-0.9.0)

### vcpkg Dependencies

Managed via `vcpkg.json` manifest. Cross-compiled for `wasm32-emscripten` during build.

Key libraries: AWS SDK (SigV4 signing, S3), roaring (bitmap indexes), avro-c, curl, openssl, jansson, snappy, lzma, zlib.

All variants share one `vcpkg_installed/` tree and pick their libraries at link time. Spatial's GEOS, PROJ, SQLite, and Expat come from the same manifest, using the overlay ports in `deps/duckdb-spatial/vcpkg_ports`. GDAL is not built.

Initialize `deps/duckdb-spatial` for every variant. Apply its patches before the shared vcpkg install, including when building the browser first: GEOS and PROJ need exception catching enabled at compilation. Always run `vcpkg install` so its ABI checks rebuild stale dependencies; archive existence alone is not a valid cache check. CI cache keys include the SDK version, overlay ports, and Spatial patches.

Version pins: `VCPKG_BASELINE` in Makefile, `builtin-baseline` in vcpkg.json. `vcpkg_ports/avro-c` overrides DuckDB's port registry so vcpkg builds the exact `duckdb-avro-c` commit that `deps/duckdb-avro` vendors. Update its `REF` and `SHA512` whenever the Avro pin moves.

### npm Dependencies

- `@uwdata/flechette` - Arrow IPC encoding/decoding
- `tsup` - TypeScript bundler
- `vitest` - Testing

## API Differences

| Feature | Browser (`@ducklings/browser`) | Base Workers (`@ducklings/workers`) | Workers DuckLake (`@ducklings/workers-ducklake`) |
|---------|------------------------------|----------------------------------------|-----------------------------------------------|
| `init()` | `await init()`, `init(wasmUrl)`, or `init({ wasmUrl, wasmJsUrl, workerUrl, worker })` | `await init({ wasmModule, httpFetch? })` | `await init({ wasmModule, httpFetch? })` |
| `connect()` | Returns `Promise<Connection>` | Returns `Connection` (sync) | Returns `Connection` (sync) |
| `query()` | Returns `Promise<T[]>` | Returns `Promise<T[]>` | Returns `Promise<T[]>` |
| `execute()` | Returns `Promise<number>` | Returns `Promise<number>` | Returns `Promise<number>` |
| `queryArrow()` | Returns `Promise<Table>` | Returns `Promise<Table>` | Returns `Promise<Table>` |
| Execution | In a Web Worker (message protocol) | In the Worker isolate | In the Worker isolate |
| httpfs | Sync XMLHttpRequest inside the Web Worker | fetch() via Asyncify | fetch() via Asyncify |

`@ducklings/workers-iceberg` and `@ducklings/workers-spatial` have the same API as `@ducklings/workers`.

## Development Notes

- The workers packages share `packages/ducklings-workers-shared`
- Types are shared between the workers package flavors
- Both packages use pnpm workspaces
- WASM files are copied into each package during build (not shared)
- Example packages use `workspace:*` dependency for local development

## Limitations

### No Dynamic Extension Loading

Runtime extension loading (`INSTALL`/`LOAD` commands) is **disabled**. Only statically compiled extensions are available: the browser and base Workers builds include Parquet and httpfs; the Workers Iceberg build includes Parquet, httpfs, Avro, and Iceberg; the Workers DuckLake build includes Parquet, httpfs, the Quack client, and DuckLake; the Workers Spatial build includes Parquet, httpfs, and Spatial (GEOS + PROJ, no GDAL). JSON is omitted from the browser and all published Workers builds; only the `debug-workers*` local-debug builds include it.

**Why?** Dynamic extension loading in WASM requires Emscripten's `-sMAIN_MODULE` flag, which significantly increases binary size (~2-3x). This conflicts with the project's goal of minimal footprint.

**What works:**
- `SELECT * FROM 'https://example.com/data.parquet'` (httpfs + Parquet)
- `SELECT * FROM iceberg_scan('https://example.com/iceberg-table')` (Iceberg)
- `SELECT * FROM iceberg_snapshots('https://example.com/iceberg-table')` (Iceberg metadata)
- `SELECT * FROM read_avro('https://example.com/data.avro')` (Avro)
- All built-in DuckDB functions

**What doesn't work:**
- `INSTALL <ext>` → Error: "Permission Error: Installing external extensions is not supported: this build does not link the loadable_extensions library"
- `LOAD <ext>` → Error: "Permission Error: Loading external extensions is not supported: this build does not link the loadable_extensions library"
- Any extension not compiled into the WASM binary
