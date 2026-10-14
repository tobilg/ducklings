import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: '../ducklings-workers-shared/src/index.ts' },
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
});
