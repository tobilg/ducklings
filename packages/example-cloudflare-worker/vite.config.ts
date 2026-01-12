import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

// Path to the WASM file in the workspace
const wasmSrcPath = resolve(__dirname, '../ducklings-workers/dist/wasm/duckdb-workers.wasm');

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
      // Mark WASM import as external - wrangler will handle it
      external: [/\.wasm$/],
    },
    target: 'es2022',
    minify: 'esbuild',
    copyPublicDir: false,
  },

  plugins: [
    {
      name: 'cloudflare-wasm',
      enforce: 'pre',

      // Resolve WASM imports from the package to relative path
      resolveId(id, importer) {
        if (id === '@ducklings/workers/wasm') {
          // Return external reference that will be resolved at runtime
          return { id: './duckdb-workers.wasm', external: true };
        }
        return null;
      },

      // Copy WASM file to dist after build
      closeBundle() {
        const wasmDest = resolve(__dirname, 'dist/duckdb-workers.wasm');
        try {
          mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
          copyFileSync(wasmSrcPath, wasmDest);
          console.log('Copied WASM file to dist/');
        } catch (e) {
          console.error('Failed to copy WASM file:', e);
        }
      },
    },
  ],
});
