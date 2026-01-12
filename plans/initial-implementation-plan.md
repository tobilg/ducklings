# duckdb-wasm-nano Implementation Plan

## Overview

Create a minimal DuckDB WASM build for Cloudflare Workers (target: under 3MB) using:
- **duckdb-rs** pattern with **wasm-bindgen** for Rust→JS bindings
- **Flechette** instead of Apache Arrow for Arrow data handling
- **Parquet** support (required), JSON optional
- **httpfs** for remote data loading
- **Async-only** TypeScript API

## Why Hybrid Build is Required

**Note on `DUCKDB_DOWNLOAD_LIB`**: This duckdb-rs feature only downloads pre-built **native** binaries (macOS, Linux, Windows). It does NOT support WASM targets - see `LibduckdbArchive::for_target()` in `build.rs:531-555`.

We need a hybrid approach because:
1. **DuckDB is C++** - wasm-bindgen only works with Rust, not C++
2. **No pre-built WASM** - DuckDB doesn't publish WASM binaries on GitHub releases
3. **Solution**: Use **wasi-sdk** (Clang + WASI) for C++ → WASM, then Rust/wasm-bindgen for JS interface

## Why wasi-sdk over Emscripten

| Aspect | wasi-sdk | Emscripten |
|--------|----------|------------|
| Size | ~3-5 MB | ~5-8 MB |
| Runtime | Minimal WASI | Full POSIX emulation |
| wasm-bindgen | Clean integration | Runtime conflicts possible |
| Cloudflare | Native WASI support | Needs adaptation |
| C++ stdlib | libc++ included | Full stdlib |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TypeScript API (packages/)                    │
│  DuckDB class → Connection → query() → Flechette Table          │
├─────────────────────────────────────────────────────────────────┤
│                 wasm-bindgen JS Glue Layer                       │
├─────────────────────────────────────────────────────────────────┤
│          Rust Wrapper (crates/duckdb-wasm-nano/)                 │
│  #[wasm_bindgen] exports, Arrow IPC output, HTTP bridge          │
├─────────────────────────────────────────────────────────────────┤
│          Rust FFI (crates/duckdb-wasm-nano-sys/)                 │
│  Low-level bindings to DuckDB C API                              │
├─────────────────────────────────────────────────────────────────┤
│         Pre-compiled DuckDB WASM (via wasi-sdk)                  │
│  Core + Parquet + httpfs extensions, minimal build               │
├─────────────────────────────────────────────────────────────────┤
│              Cloudflare Workers WASI Runtime                     │
│  Native WASI syscall handling (no JS polyfills needed)           │
└─────────────────────────────────────────────────────────────────┘
```

### Cloudflare Workers WASI Advantage

Cloudflare Workers has native WASI support, which means:
- **No JS polyfills** for WASI syscalls (memory, etc.)
- **Direct runtime handling** of WASI operations
- **Better performance** than JS-bridged approaches
- **Simpler integration** with wasm-bindgen

## Project Structure

```
duckdb-wasm-nano/
├── Cargo.toml                     # Workspace root
├── Makefile                       # Top-level build orchestration
├── .gitmodules                    # Git submodule definitions
├── deps/                          # Git submodules (dependencies)
│   ├── duckdb/                    # DuckDB source v1.4.3 (submodule)
│   ├── duckdb-rs/                 # Rust bindings reference (submodule)
│   ├── duckdb-httpfs/             # httpfs extension (submodule)
│   └── flechette/                 # Flechette Arrow lib v2.2.6 (submodule)
├── crates/
│   ├── duckdb-wasm-nano-sys/      # Low-level FFI bindings
│   │   ├── Cargo.toml
│   │   ├── build.rs               # Links pre-compiled WASM
│   │   └── src/lib.rs             # FFI declarations from duckdb.h
│   └── duckdb-wasm-nano/          # High-level API with wasm-bindgen
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs             # #[wasm_bindgen] exports
│           ├── database.rs        # DuckDBWasmNano struct
│           ├── connection.rs      # Connection handling
│           ├── result.rs          # Query results → Arrow IPC
│           └── http_bridge.rs     # HTTP bridge for httpfs
├── packages/
│   └── duckdb-wasm-nano/          # TypeScript package
│       ├── package.json
│       └── src/
│           ├── index.ts           # Main exports
│           ├── duckdb.ts          # DuckDB class wrapper
│           ├── connection.ts      # Connection class
│           ├── result.ts          # Flechette integration
│           └── http-bridge.ts     # JS fetch for httpfs
├── scripts/
│   ├── build-duckdb.sh            # DuckDB wasi-sdk build
│   └── build-wasm.sh              # Full build pipeline
├── build/                         # Build output directory
│   └── wasm/
│       └── libduckdb.a            # Pre-compiled DuckDB static lib
├── dist/                          # Final distribution artifacts
├── examples/
│   └── browser/
│       ├── index.html             # Browser test example
│       └── vite.config.js         # Dev server config
└── docs/                          # Generated TypeDoc API docs
```

## Build Infrastructure

### Git Submodules

Dependencies are managed as git submodules for version pinning and reproducibility:

```bash
# .gitmodules
[submodule "deps/duckdb"]
    path = deps/duckdb
    url = https://github.com/duckdb/duckdb.git
    # Pin to v1.4.3

[submodule "deps/duckdb-rs"]
    path = deps/duckdb-rs
    url = https://github.com/duckdb/duckdb-rs.git
    # Reference for Rust FFI patterns

[submodule "deps/duckdb-httpfs"]
    path = deps/duckdb-httpfs
    url = https://github.com/duckdb/duckdb-httpfs.git
    # Match DuckDB v1.4.3 compatible version

[submodule "deps/flechette"]
    path = deps/flechette
    url = https://github.com/uwdata/flechette.git
    # Latest: v2.2.6
```

**Version Pinning:**
After initial clone, pin to specific versions:
```bash
cd deps/duckdb && git checkout v1.4.3
cd ../duckdb-rs && git checkout v1.4.3
cd ../duckdb-httpfs && git checkout 9c7d34977b10346d0b4cbbde5df807d1dab0b2bf  # Compatible with DuckDB v1.4.3
cd ../flechette && git checkout v2.2.6
```

**Note:** The httpfs commit is sourced from DuckDB's extension config:
`https://github.com/duckdb/duckdb/blob/v1.4.3/.github/config/extensions/httpfs.cmake`

**Setup commands:**
```bash
git submodule update --init --recursive
```

**Update dependencies:**
```bash
cd deps/duckdb && git fetch && git checkout v1.3.0  # Update to new version
cd ../.. && git add deps/duckdb && git commit -m "Update DuckDB to v1.3.0"
```

### Makefile

```makefile
# Top-level Makefile for reproducible builds

WASI_SDK_PATH ?= /opt/wasi-sdk
BUILD_DIR := build
DIST_DIR := dist

# Version pinning
DUCKDB_VERSION := v1.4.3
DUCKDB_RS_VERSION := v1.4.3
HTTPFS_COMMIT := 9c7d34977b10346d0b4cbbde5df807d1dab0b2bf
FLECHETTE_VERSION := v2.2.6

.PHONY: all clean deps pin-versions duckdb rust typescript

all: deps duckdb rust typescript

# Initialize submodules and pin to specific versions
deps:
	git submodule update --init --recursive
	$(MAKE) pin-versions

# Pin all dependencies to exact versions for reproducible builds
pin-versions:
	cd deps/duckdb && git fetch --tags && git checkout $(DUCKDB_VERSION)
	cd deps/duckdb-rs && git fetch --tags && git checkout $(DUCKDB_RS_VERSION)
	cd deps/duckdb-httpfs && git fetch && git checkout $(HTTPFS_COMMIT)
	cd deps/flechette && git fetch --tags && git checkout $(FLECHETTE_VERSION)

# Build DuckDB with wasi-sdk
duckdb:
	./scripts/build-duckdb.sh

# Build Rust crates
rust: duckdb
	cargo build --release --target wasm32-wasi

# Build TypeScript package
typescript: rust
	cd packages/duckdb-wasm-nano && pnpm install && pnpm build

# Clean all build artifacts
clean:
	rm -rf $(BUILD_DIR) $(DIST_DIR)
	rm -rf target
	cd packages/duckdb-wasm-nano && rm -rf node_modules dist

# Fresh build from scratch
rebuild: clean all

# Update all dependencies to latest (then manually update version vars above)
update-deps:
	git submodule update --remote --merge
	@echo "Dependencies updated. Review and update version variables in Makefile."

# Check wasi-sdk installation
check-deps:
	@test -d $(WASI_SDK_PATH) || (echo "wasi-sdk not found at $(WASI_SDK_PATH)" && exit 1)
	@$(WASI_SDK_PATH)/bin/clang++ --version
	@cargo --version
	@pnpm --version

# Show current pinned versions
show-versions:
	@echo "DuckDB: $(DUCKDB_VERSION)"
	@echo "duckdb-rs: $(DUCKDB_RS_VERSION)"
	@echo "httpfs: $(HTTPFS_COMMIT)"
	@echo "Flechette: $(FLECHETTE_VERSION)"

# Generate API documentation
docs:
	cd packages/duckdb-wasm-nano && pnpm run docs

# Run browser example (dev server)
example:
	cd examples/browser && pnpm install && pnpm dev

# Full build including docs
dist: all docs
	@echo "Distribution ready in dist/"
```

### Build Prerequisites

Document required tools in README:
```bash
# Required tools
- wasi-sdk 20+ (https://github.com/WebAssembly/wasi-sdk)
- Rust 1.75+ with wasm32-wasi target
- pnpm 8+
- cmake 3.20+

# Install Rust WASM target
rustup target add wasm32-wasi

# macOS: Install wasi-sdk
brew install wasi-sdk

# Verify setup
make check-deps
```

### CI/CD (GitHub Actions)

```yaml
# .github/workflows/build.yml
name: Build
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Install wasi-sdk
        run: |
          wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-20/wasi-sdk-20.0-linux.tar.gz
          tar xf wasi-sdk-20.0-linux.tar.gz
          echo "WASI_SDK_PATH=$PWD/wasi-sdk-20.0" >> $GITHUB_ENV

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-wasi

      - uses: pnpm/action-setup@v2

      - run: make all
```

## Implementation Steps

### Step 1: DuckDB WASM Compilation with wasi-sdk

Use wasi-sdk (Clang + WASI libc + libc++) to compile DuckDB:

**Prerequisites:**
```bash
# Install wasi-sdk (https://github.com/WebAssembly/wasi-sdk)
# macOS: brew install wasi-sdk
# Or download from GitHub releases to /opt/wasi-sdk
```

**Build configuration:**
```bash
export WASI_SDK_PATH=/opt/wasi-sdk
export CC="${WASI_SDK_PATH}/bin/clang"
export CXX="${WASI_SDK_PATH}/bin/clang++"

cmake -DCMAKE_TOOLCHAIN_FILE=${WASI_SDK_PATH}/share/cmake/wasi-sdk.cmake \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS="-Oz -flto -fno-exceptions -DNDEBUG" \
  -DBUILD_PARQUET_EXTENSION=ON \
  -DBUILD_JSON_EXTENSION=OFF \
  -DDUCKDB_NO_THREADS=1 \
  -DDISABLE_EXTENSION_LOAD=1 \
  -DSMALLER_BINARY=1 \
  -DWASM_LOADABLE_EXTENSIONS=0 \
  ..
```

**Output:** `libduckdb.a` static library for wasm32-wasi

**Reference files:**
- `deps/duckdb/CMakeLists.txt`
- wasi-sdk CMake toolchain file

### Step 1b: httpfs Extension for WASI

The httpfs extension needs adaptation for wasi-sdk (it currently only detects `EMSCRIPTEN`):

**Changes needed in httpfs CMakeLists.txt:**
```cmake
# Detect both emscripten and wasi-sdk for WASM builds
if (CMAKE_SYSTEM_NAME STREQUAL "WASI" OR EMSCRIPTEN)
  # WASM path: use mbedtls, stub HTTP client
  set(HTTPFS_SOURCES ${HTTPFS_SOURCES} httpfs_client_wasm.cpp)
  set(DUCKDB_EXTENSION_HTTPFS_LINKED_LIBS "mbedtls")
else()
  # Native path: libcurl, OpenSSL
  set(HTTPFS_SOURCES ${HTTPFS_SOURCES} crypto.cpp httpfs_httplib_client.cpp)
endif()
```

**Key points:**
- WASI has **no networking syscalls** - HTTP must be bridged to JavaScript
- The existing `httpfs_client_wasm.cpp` stub works for our approach
- mbedtls compiles cleanly with wasi-sdk (needed for S3 signing)
- We'll provide the HTTP implementation via JS fetch API

**Reference:** `deps/duckdb-httpfs/CMakeLists.txt`

### Step 2: Rust FFI Layer (duckdb-wasm-nano-sys)

Create FFI bindings to DuckDB C API:

```rust
// Key functions from deps/duckdb/src/include/duckdb.h
#[link(name = "duckdb", kind = "static")]
extern "C" {
    pub fn duckdb_open(path: *const c_char, db: *mut duckdb_database) -> duckdb_state;
    pub fn duckdb_close(db: *mut duckdb_database);
    pub fn duckdb_connect(db: duckdb_database, conn: *mut duckdb_connection) -> duckdb_state;
    pub fn duckdb_disconnect(conn: *mut duckdb_connection);
    pub fn duckdb_query(conn: duckdb_connection, sql: *const c_char, result: *mut duckdb_result) -> duckdb_state;

    // Arrow interface (critical for Flechette)
    pub fn duckdb_query_arrow(conn: duckdb_connection, sql: *const c_char, result: *mut duckdb_arrow) -> duckdb_state;
    pub fn duckdb_query_arrow_array(result: duckdb_arrow, chunk: *mut duckdb_arrow_array) -> duckdb_state;
}
```

**Reference:** `deps/duckdb-rs/crates/libduckdb-sys/`

### Step 3: Rust Wrapper with wasm-bindgen (duckdb-wasm-nano)

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct DuckDBWasmNano { /* ... */ }

#[wasm_bindgen]
impl DuckDBWasmNano {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<DuckDBWasmNano, JsValue>;

    pub fn connect(&self) -> Result<DuckDBConnection, JsValue>;
}

#[wasm_bindgen]
pub struct DuckDBConnection { /* ... */ }

#[wasm_bindgen]
impl DuckDBConnection {
    // Returns Arrow IPC bytes for Flechette
    pub fn query(&self, sql: &str) -> Promise;
    pub fn execute(&self, sql: &str) -> Promise;
}
```

**Reference:** wasm-bindgen docs: https://rustwasm.github.io/wasm-bindgen/

### Step 4: HTTP Bridge for httpfs

The httpfs extension needs a JS fetch bridge:

**Rust side:**
```rust
#[wasm_bindgen(raw_module = "./http_bridge")]
extern "C" {
    async fn http_fetch(url: &str, method: &str, headers: JsValue) -> JsValue;
}
```

**JS side (http-bridge.ts):**
```typescript
export async function httpFetch(url: string, method: string, headers: Record<string, string>) {
    const response = await fetch(url, { method, headers });
    return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
}
```

**Reference:** `deps/duckdb-httpfs/src/httpfs_client_wasm.cpp`

### Step 5: TypeScript API with Flechette

```typescript
import { tableFromIPC, Table } from '@uwdata/flechette';
import init, { DuckDBWasmNano as WasmDB } from 'duckdb-wasm-nano';

export class DuckDB {
    private db: WasmDB;

    static async create(): Promise<DuckDB>;
    async connect(): Promise<Connection>;
    async close(): Promise<void>;
}

export class Connection {
    async query(sql: string): Promise<Table>;  // Returns Flechette Table
    async execute(sql: string): Promise<void>;
    close(): void;
}
```

**Reference:** `deps/flechette/src/index.js`

### Step 6: Browser Example

Create a test page for browser validation:

**examples/browser/index.html:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DuckDB WASM Nano - Browser Test</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
        #output { background: #f5f5f5; padding: 1rem; border-radius: 4px; white-space: pre-wrap; }
        button { padding: 0.5rem 1rem; margin: 0.5rem 0; }
        textarea { width: 100%; height: 100px; font-family: monospace; }
    </style>
</head>
<body>
    <h1>DuckDB WASM Nano Test</h1>

    <div>
        <label for="sql">SQL Query:</label>
        <textarea id="sql">SELECT 42 AS answer, 'Hello from DuckDB WASM Nano!' AS message</textarea>
    </div>

    <button id="run">Run Query</button>
    <button id="remote">Load Remote Parquet</button>

    <h2>Output:</h2>
    <pre id="output">Ready. Click "Run Query" to start.</pre>

    <script type="module">
        import { DuckDB } from './dist/duckdb-wasm-nano.js';

        let db, conn;

        async function init() {
            document.getElementById('output').textContent = 'Initializing DuckDB...';
            db = await DuckDB.create();
            conn = await db.connect();
            document.getElementById('output').textContent = 'DuckDB ready!';
        }

        document.getElementById('run').addEventListener('click', async () => {
            const sql = document.getElementById('sql').value;
            try {
                const result = await conn.query(sql);
                document.getElementById('output').textContent = JSON.stringify(result.toArray(), null, 2);
            } catch (err) {
                document.getElementById('output').textContent = `Error: ${err.message}`;
            }
        });

        document.getElementById('remote').addEventListener('click', async () => {
            const sql = `SELECT * FROM 'https://shell.duckdb.org/data/tpch/0_01/parquet/lineitem.parquet' LIMIT 10`;
            document.getElementById('output').textContent = 'Loading remote Parquet...';
            try {
                const result = await conn.query(sql);
                document.getElementById('output').textContent = JSON.stringify(result.toArray(), null, 2);
            } catch (err) {
                document.getElementById('output').textContent = `Error: ${err.message}`;
            }
        });

        init();
    </script>
</body>
</html>
```

**Run browser example:**
```bash
cd examples/browser && pnpm install && pnpm dev
# Opens http://localhost:5173
```

### Step 7: API Documentation (TypeDoc)

**packages/duckdb-wasm-nano/typedoc.json:**
```json
{
    "entryPoints": ["src/index.ts"],
    "out": "../../docs",
    "name": "DuckDB WASM Nano API",
    "excludePrivate": true,
    "excludeInternal": true,
    "includeVersion": true
}
```

**Add to package.json scripts:**
```json
{
  "scripts": {
    "docs": "typedoc",
    "docs:watch": "typedoc --watch"
  },
  "devDependencies": {
    "typedoc": "^0.25.0"
  }
}
```

### Step 8: Size Optimization

**Rust profile (Cargo.toml):**
```toml
[profile.release]
opt-level = 'z'
lto = true
codegen-units = 1
panic = 'abort'
strip = true
```

**Post-build:**
```bash
wasm-opt -Oz --enable-bulk-memory -o optimized.wasm input.wasm
```

## Size Budget (with wasi-sdk)

| Component | Est. Size (gzip) |
|-----------|------------------|
| DuckDB Core (wasi-sdk) | ~1.2 MB |
| Parquet extension | ~250 KB |
| httpfs extension + mbedtls | ~150 KB |
| WASI libc/runtime | ~100 KB |
| Rust wrapper | ~50 KB |
| Flechette | ~14 KB |
| **Total** | **~1.8 MB** |

*Note: wasi-sdk produces smaller output than emscripten (~3-5MB vs ~5-8MB uncompressed)*

## Key Reference Files

1. `deps/duckdb/src/include/duckdb.h` - C API (6223 lines)
2. `deps/duckdb-rs/crates/libduckdb-sys/build.rs` - Rust build pattern
3. `deps/duckdb/CMakeLists.txt` - DuckDB build config (adapt for wasi-sdk)
4. `deps/duckdb-httpfs/src/httpfs_client_wasm.cpp` - HTTP stub
5. `deps/flechette/src/table.js` - Flechette Table API
6. wasm-bindgen docs: https://rustwasm.github.io/wasm-bindgen/

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Size > 3MB | Remove JSON ext, strip unused functions, lazy loading |
| Sync HTTP incompatible | Async-first design with cooperative scheduling |
| Memory limits (128MB) | Query streaming, result pagination |
| wasi-sdk compatibility | DuckDB may need patches for WASI (originally targets emscripten); fall back to emscripten if blocking issues |

## Future Optimizations

### Parallel HTTP Requests (Phase 2)
The initial implementation uses **sequential HTTP requests** (matching current duckdb-wasm behavior). Future optimization:

- **Prefetch mechanism**: Anticipate needed byte ranges for Parquet row groups
- **Request batching**: Queue multiple requests and issue in parallel at JS level
- **Benefit**: Significant performance improvement for large remote Parquet files

```typescript
// Future: Parallel fetch for Parquet row groups
async function fetchParallel(ranges: ByteRange[]): Promise<Uint8Array[]> {
    return Promise.all(ranges.map(r =>
        fetch(url, { headers: { Range: `bytes=${r.start}-${r.end}` } })
    ));
}
```
