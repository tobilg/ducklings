import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: true,
    treeshake: true,
    splitting: false,
    outDir: 'dist',
    external: ['./wasm/duckdb.js', './wasm/duckdb-workers.js', 'env'],
    noExternal: ['@uwdata/flechette'],
    esbuildOptions(options) {
      options.banner = {
        js: '// Ducklings Workers Lite - non-Asyncify DuckDB for Workers',
      };
    },
  },
  {
    entry: { 'vite-plugin': 'src/vite-plugin/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    minify: false,
    treeshake: true,
    splitting: false,
    outDir: 'dist',
    external: ['vite', 'node:path', 'node:fs', 'node:url'],
    esbuildOptions(options) {
      options.banner = {
        js: '// Ducklings Workers Lite - Vite plugin',
      };
    },
  },
]);
