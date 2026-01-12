# Plan: Enable httpfs in Cloudflare Workers (Dual Build)

## Problem Statement
The httpfs extension works in browsers but fails in Cloudflare Workers with error:
```
HTTP Error: Unable to connect to URL "...": 404 (HEAD request failed).
```

## Root Cause Analysis

### Current Implementation (`src/http/http_wasm.cpp`)
The HTTP client uses **synchronous XMLHttpRequest**:
```javascript
// Lines 109-111, 222-224
if (typeof XMLHttpRequest === "undefined") {
    return 0;  // Returns failure
}
var xhr = new XMLHttpRequest();
xhr.open("HEAD", url, false);  // false = synchronous
```

### Why It Fails in Cloudflare Workers
1. **XMLHttpRequest doesn't exist** in CF Workers - it's a browser-only API
2. CF Workers only provides the **async `fetch()` API**
3. The code detects missing XMLHttpRequest and returns 0 (failure), causing the 404 error

### Why It Works in Browser
- Browser example runs DuckDB in a **Web Worker** where synchronous XHR is allowed
- The main thread communicates via postMessage

---

## Solution: Dual Build Targets

Create **two separate WASM builds**:
1. **Browser build** (current) - optimized for size, uses sync XMLHttpRequest
2. **Workers build** - uses Asyncify + fetch() for CF Workers compatibility

### Build Output Structure
```
dist/
├── duckdb.js           # Browser JS glue
├── duckdb.wasm         # Browser WASM (~5.7 MB gzipped)
├── duckdb-workers.js   # CF Workers JS glue
└── duckdb-workers.wasm # CF Workers WASM (~6.5 MB gzipped)
```

### Package Exports
```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./wasm": "./dist/wasm/duckdb.wasm",
    "./wasm/*": "./dist/wasm/*",
    "./workers": "./dist/workers/index.js",
    "./workers/wasm": "./dist/wasm/duckdb-workers.wasm"
  }
}
```

### Usage
```typescript
// Browser (unchanged)
import { init, DuckDB } from 'duckdb-wasm-nano';
await init();

// Cloudflare Workers
import { init, DuckDB } from 'duckdb-wasm-nano/workers';
import wasmModule from 'duckdb-wasm-nano/workers/wasm';
await init({ wasmModule });
```

---

## Implementation Steps

### Step 1: Add Build Target Parameter
**File**: `scripts/build-duckdb.sh`

Add a `--target` flag:
```bash
#!/bin/bash
TARGET="${1:-browser}"  # Default to browser

if [ "$TARGET" = "workers" ]; then
    ASYNCIFY_FLAGS="-sASYNCIFY -sASYNCIFY_STACK_SIZE=65536"
    OUTPUT_SUFFIX="-workers"
else
    ASYNCIFY_FLAGS=""
    OUTPUT_SUFFIX=""
fi
```

### Step 2: Conditional Asyncify in Link Step
**File**: `scripts/build-duckdb.sh`

In the emcc link command:
```bash
emcc ... \
    ${ASYNCIFY_FLAGS} \
    -o "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js" \
    ...
```

### Step 3: Modify HTTP Client for fetch() Support
**File**: `src/http/http_wasm.cpp`

Add fetch() fallback (only used when Asyncify is enabled):
```javascript
if (typeof XMLHttpRequest !== "undefined") {
    // Existing sync XHR code (browser)
} else if (typeof fetch !== "undefined" && typeof Asyncify !== "undefined") {
    // Async fetch with Asyncify (CF Workers)
    return Asyncify.handleAsync(async () => {
        var response = await fetch(url, { method, headers });
        // ... process response ...
    });
} else {
    return 0;
}
```

### Step 4: Add Makefile Targets
**File**: `Makefile`

```makefile
duckdb-browser:
	./scripts/build-duckdb.sh browser

duckdb-workers:
	./scripts/build-duckdb.sh workers

duckdb-all: duckdb-browser duckdb-workers
```

### Step 5: Create Workers-Specific TypeScript Entry
**File**: `packages/duckdb-wasm-nano/src/workers.ts`

```typescript
// Re-export everything from main, but use workers WASM
export * from './index';

// Override default WASM path for workers
export const WASM_PATH = 'duckdb-workers.wasm';
```

### Step 6: Update Package Build
**File**: `packages/duckdb-wasm-nano/package.json`

Update postbuild to copy both WASM files:
```json
"postbuild": "mkdir -p dist/wasm && cp ../../dist/duckdb*.js dist/wasm/ && cp ../../dist/duckdb*.wasm dist/wasm/"
```

---

## Files to Modify

| File | Change |
|------|--------|
| `scripts/build-duckdb.sh` | Add target parameter, conditional Asyncify |
| `src/http/http_wasm.cpp` | Add fetch() fallback with Asyncify |
| `Makefile` | Add browser/workers/all targets |
| `packages/duckdb-wasm-nano/package.json` | Add workers export, update postbuild |
| `packages/duckdb-wasm-nano/src/workers.ts` | New file for workers entry point |

---

## Complexity Analysis

| Aspect | Complexity |
|--------|------------|
| Build script changes | Low - just add conditional flags |
| HTTP client changes | Medium - add fetch() branch |
| Package structure | Low - add one export path |
| Maintenance | Low - same codebase, two build targets |

**Total added complexity**: Low to Medium

---

## Verification

### 1. Build Both Targets
```bash
make duckdb-all
ls -lh dist/duckdb*.wasm
```

### 2. Browser Test
```bash
cd packages/example-browser
pnpm dev
# Test "Load Remote Parquet" - should still work
```

### 3. Cloudflare Workers Test
Update example to use workers build, then:
```bash
cd packages/example-cloudflare-worker
pnpm run deploy
curl https://your-worker.dev/remote-parquet
```

---

## Expected Results

| Build | Size (gzipped) | httpfs in Browser | httpfs in CF Workers |
|-------|----------------|-------------------|----------------------|
| Browser | ~5.7 MB | Works | No httpfs |
| Workers | ~6.5 MB | Works | Works |

## Benefits
- **Browser users** keep the smaller, optimized build
- **CF Workers users** get full httpfs support with acceptable size increase
- **Same API** - just different import path
- **Minimal maintenance** - single codebase with build-time branching
