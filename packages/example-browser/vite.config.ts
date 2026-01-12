import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  server: {
    port: 5173,
    open: true,
    fs: {
      // Allow serving files from the workspace
      allow: ['..'],
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  optimizeDeps: {
    exclude: ['@ducklings/browser'],
  },
  assetsInclude: ['**/*.wasm'],
});
