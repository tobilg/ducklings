/**
 * Vite plugin for @ducklings/workers on Cloudflare Workers
 *
 * This plugin handles WASM file resolution and copying for Cloudflare Workers deployments.
 *
 * @packageDocumentation
 */

import { resolve, dirname } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Vite Plugin interface (minimal definition to avoid hard dependency on vite types)
 */
interface VitePlugin {
  name: string;
  enforce?: 'pre' | 'post';
  configResolved?: (config: { root: string }) => void;
  resolveId?: (id: string) => { id: string; external: true } | null;
  closeBundle?: () => void;
}

/**
 * Configuration options for the Ducklings Workers Vite plugin.
 */
export interface DucklingsWorkersPluginOptions {
  /**
   * Output directory for the build.
   * @default 'dist'
   */
  outDir?: string;

  /**
   * Name of the WASM file in the output directory.
   * @default 'duckdb-workers.wasm'
   */
  wasmFileName?: string;

  /**
   * Whether to copy the WASM file to the output directory.
   * Set to false if you handle WASM file copying separately.
   * @default true
   */
  copyWasm?: boolean;
}

/**
 * Resolves the path to the WASM file bundled with @ducklings/workers.
 *
 * @returns The absolute path to the WASM file
 */
export function getWasmPath(): string {
  // Get the directory of this module
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // WASM file is in the wasm subdirectory relative to dist
  return resolve(currentDir, 'wasm', 'duckdb-workers.wasm');
}

/**
 * Vite plugin for Cloudflare Workers that handles Ducklings Workers WASM integration.
 *
 * This plugin:
 * - Resolves `@ducklings/workers/wasm` imports to a relative path for wrangler
 * - Optionally copies the WASM file to your output directory
 *
 * @param options - Plugin configuration options
 * @returns Vite plugin
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { ducklingsWorkerPlugin } from '@ducklings/workers/vite-plugin';
 *
 * export default defineConfig({
 *   plugins: [ducklingsWorkerPlugin()],
 *   build: {
 *     rollupOptions: {
 *       external: [/\.wasm$/],
 *     },
 *   },
 * });
 * ```
 */
export function ducklingsWorkerPlugin(options: DucklingsWorkersPluginOptions = {}): VitePlugin {
  const { outDir = 'dist', wasmFileName = 'duckdb-workers.wasm', copyWasm = true } = options;

  let projectRoot: string;

  return {
    name: 'ducklings-workers-plugin',
    enforce: 'pre' as const,

    configResolved(config) {
      projectRoot = config.root;
    },

    // Resolve WASM imports from the package to relative path
    resolveId(id) {
      if (id === '@ducklings/workers/wasm') {
        // Return external reference that will be resolved at runtime by wrangler
        return { id: `./${wasmFileName}`, external: true as const };
      }
      return null;
    },

    // Copy WASM file to output directory after build
    closeBundle() {
      if (!copyWasm) return;

      const wasmSrcPath = getWasmPath();
      const wasmDestPath = resolve(projectRoot, outDir, wasmFileName);

      try {
        mkdirSync(resolve(projectRoot, outDir), { recursive: true });
        copyFileSync(wasmSrcPath, wasmDestPath);
        console.log(`[ducklings] Copied WASM file to ${outDir}/${wasmFileName}`);
      } catch (e) {
        console.error('[ducklings] Failed to copy WASM file:', e);
      }
    },
  };
}

export default ducklingsWorkerPlugin;
