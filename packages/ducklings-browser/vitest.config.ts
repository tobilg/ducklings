import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['dist/index.js'],
      exclude: ['src/**/*.d.ts', 'dist/wasm/**'],
    },
    // Uses the 'dot' reporter for ultra-concise output
    reporters: ['dot'],
    // Ensure 'watch' is off so the agent isn't stuck in a loop
    watch: false, 
    testTimeout: 30000,
    hookTimeout: 60000,
    // Vitest 4: Run tests sequentially with isolation per file
    fileParallelism: false,
    isolate: true,  // Enable module isolation - each test file gets fresh WASM instance
    sequence: {
      concurrent: false,
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
