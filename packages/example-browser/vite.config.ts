import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { viteStaticCopy } from 'vite-plugin-static-copy';

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
  plugins: [
    viteStaticCopy({
      targets: [
        {
          // Copy worker.js to assets folder (same location as bundled JS)
          src: '../ducklings-browser/dist/worker.js',
          dest: 'assets',
        },
        {
          // Copy WASM files
          src: '../ducklings-browser/dist/wasm/*',
          dest: 'assets/wasm',
        },
      ],
    }),
  ],
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
