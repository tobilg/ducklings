# Ducklings

A minimal DuckDB WASM build for browsers and serverless environments like Cloudflare Workers.

## Goals

- Minimal footprint/size without sacrificing essential features
- TypeScript API for JavaScript/TypeScript access
- Remote data loading via httpfs extension
- Use Flechette instead of apache-arrow for JS/Arrow bridging
- First-class Cloudflare Workers support

## Packages

The project publishes two npm packages:

| Package | Description | API Style |
|---------|-------------|-----------|
| `@ducklings/browser` | Browser version | Sync |
| `@ducklings/workers` | Cloudflare Workers version | Async (Promises) |

**Why two packages?** Cloudflare Workers doesn't support synchronous XMLHttpRequest. The workers package uses Emscripten's Asyncify to enable async `fetch()` calls, making httpfs work properly.

## Project Structure

```
ducklings/
├── Makefile                       # Build orchestration
├── deps/                          # Git submodules
│   ├── duckdb/                    # DuckDB v1.4.3 (C++ source)
│   └── duckdb-httpfs/             # httpfs extension source
├── dist/                          # WASM build output
│   ├── duckdb.js                  # Browser JS glue
│   ├── duckdb.wasm                # Browser WASM binary
│   ├── duckdb-workers.js          # Workers JS glue (Asyncify)
│   └── duckdb-workers.wasm        # Workers WASM binary
├── patches/                       # Source patches for dependencies
│   └── duckdb/                    # DuckDB-specific patches
│       └── preloaded_httpfs.patch # httpfs preload recognition
├── packages/
│   ├── ducklings-browser/         # @ducklings/browser (npm)
│   ├── ducklings-workers/         # @ducklings/workers (npm)
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
- Emscripten SDK 3.1.50
- Binaryen (for wasm-opt)

### Make Targets

```bash
# Full build
make all                  # Build browser WASM + TypeScript package

# WASM compilation (requires Emscripten)
make duckdb-browser       # Compile browser WASM (~2 min)
make duckdb-workers       # Compile workers WASM with Asyncify (~3 min)
make duckdb-all           # Build both WASM variants

# TypeScript packages
make typescript-browser   # Build @ducklings/browser package
make typescript-workers   # Build @ducklings/workers package
make typescript-all       # Build both packages

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

## Key Files

### TypeScript API

- `packages/ducklings-browser/src/index.ts` - Browser API (sync)
- `packages/ducklings-workers/src/index.ts` - Workers API (async, standalone)

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
- Extensions built-in: Parquet, httpfs, JSON
- Workers build adds `-sASYNCIFY` for async fetch support

### Patch System

DuckDB source requires patches for WASM compatibility. Patches are stored in `patches/duckdb/` and applied automatically during build.

**Current Patches:**

| Patch | Purpose |
|-------|---------|
| `preloaded_httpfs.patch` | Makes DuckDB recognize httpfs as preloaded |

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
1. Build WASM (browser + workers)
2. Build TypeScript packages
3. Set package versions from tag
4. Publish to npm (both packages)
5. Create GitHub release with WASM binaries

Required secret: `NPM_TOKEN`

## Dependencies

### Git Submodules (deps/)

- `duckdb` - DuckDB v1.4.3 source code
- `duckdb-httpfs` - httpfs extension source

### npm Dependencies

- `@uwdata/flechette` - Arrow IPC encoding/decoding
- `tsup` - TypeScript bundler
- `vitest` - Testing

## API Differences

| Feature | Browser (`@ducklings/browser`) | Workers (`@ducklings/workers`) |
|---------|------------------------------|--------------------------------------|
| `init()` | `await init()` or `init(wasmUrl)` | `await init({ wasmModule })` |
| `query()` | Returns `T[]` (sync) | Returns `Promise<T[]>` (async) |
| `execute()` | Returns `number` (sync) | Returns `Promise<number>` (async) |
| `queryArrow()` | Returns `Table` (sync) | Returns `Promise<Table>` (async) |
| httpfs | Uses XMLHttpRequest | Uses fetch() via Asyncify |

## Development Notes

- The workers package is standalone (doesn't import from browser package)
- Types are duplicated between packages for simplicity
- Both packages use pnpm workspaces
- WASM files are copied into each package during build (not shared)
- Example packages use `workspace:*` dependency for local development

## Limitations

### No Dynamic Extension Loading

Runtime extension loading (`INSTALL`/`LOAD` commands) is **disabled**. Only statically compiled extensions (Parquet, JSON, httpfs) are available.

**Why?** Dynamic extension loading in WASM requires Emscripten's `-sMAIN_MODULE` flag, which significantly increases binary size (~2-3x). This conflicts with the project's goal of minimal footprint.

**What works:**
- `SELECT * FROM 'https://example.com/data.parquet'` (httpfs + Parquet)
- `SELECT * FROM read_json('file.json')` (JSON)
- All built-in DuckDB functions

**What doesn't work:**
- `INSTALL iceberg` → Error: "Installing external extensions is disabled through a compile time flag"
- `LOAD iceberg` → Error: "Loading external extensions is disabled through a compile time flag"
- Any extension not compiled into the WASM binary
