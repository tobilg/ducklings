# @ducklings/example-browser

Browser example for [Ducklings](https://github.com/tobilg/ducklings) — a minimal DuckDB WASM build.

## Prerequisites

This example depends on `@ducklings/browser` via a pnpm workspace link. Since the package's `dist/` directory is not checked into git, **you must build it before running the example**.

From the repository root:

```bash
# 1. Install dependencies
pnpm install

# 2. Build WASM binary (~2 min, requires Emscripten)
make duckdb-browser

# 3. Build the TypeScript package
make typescript-browser
```

## Running

```bash
cd packages/example-browser
pnpm run dev
```

## Building

```bash
pnpm run build
pnpm run preview
```
