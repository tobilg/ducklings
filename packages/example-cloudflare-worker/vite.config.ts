import { defineConfig } from 'vite';
import { resolve } from 'path';
import { ducklingsWorkerPlugin } from '@ducklings/workers/vite-plugin';

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

  plugins: [ducklingsWorkerPlugin()],
});
