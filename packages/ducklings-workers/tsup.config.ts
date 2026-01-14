import { defineConfig } from 'tsup';

export default defineConfig([
  // Main library build
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: true,
    treeshake: true,
    splitting: false,
    outDir: 'dist',
    external: ['./wasm/duckdb-workers.js', 'env'],
    noExternal: ['@uwdata/flechette'],
    esbuildOptions(options) {
      options.banner = {
        js: '// Ducklings Workers - Minimal DuckDB for Cloudflare Workers',
      };
    },
  },
  // Vite plugin build
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
        js: '// Ducklings Workers - Vite Plugin for Cloudflare Workers',
      };
    },
  },
]);
