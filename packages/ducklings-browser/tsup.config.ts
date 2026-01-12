import { defineConfig } from 'tsup';

export default defineConfig([
  // Main bundle
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: true,
    treeshake: true,
    splitting: false,
    outDir: 'dist',
    // Mark wasm-related imports as external since they need special handling
    external: ['./wasm/duckdb.js', '../wasm/duckdb.js', 'env'],
    noExternal: ['@uwdata/flechette'],
    esbuildOptions(options) {
      options.banner = {
        js: '// Ducklings - Minimal DuckDB for browsers',
      };
    },
  },
  // Worker bundle
  {
    entry: { worker: 'src/worker/index.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: false, // Don't clean again
    minify: true,
    treeshake: true,
    splitting: false,
    outDir: 'dist',
    external: ['../wasm/duckdb.js', 'env'],
    noExternal: ['@uwdata/flechette'],
    esbuildOptions(options) {
      options.banner = {
        js: '// Ducklings Worker',
      };
    },
  },
]);
