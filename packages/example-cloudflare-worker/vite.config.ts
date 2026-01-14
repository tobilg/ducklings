import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { ducklingsWorkerPlugin } from '@ducklings/workers/vite-plugin';

export default defineConfig({
  plugins: [
    ducklingsWorkerPlugin(),
    cloudflare(),
  ],
});
