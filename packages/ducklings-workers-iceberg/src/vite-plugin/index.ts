/**
 * Vite plugin for @ducklings/workers on Cloudflare Workers
 *
 * This plugin handles WASM file resolution and emission for Cloudflare Workers deployments.
 * Designed to work with @cloudflare/vite-plugin.
 *
 * @packageDocumentation
 */

import { resolve, dirname, join } from 'node:path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Vite Plugin interface (minimal definition to avoid hard dependency on vite types)
 */
interface VitePlugin {
  name: string;
  enforce?: 'pre' | 'post';
  configResolved?: (config: ResolvedConfig) => void;
  resolveId?: (id: string) => { id: string; external: true } | null;
  writeBundle?: (options: { dir?: string }, bundle: Record<string, unknown>) => void;
}

interface ResolvedConfig {
  root: string;
  build: {
    outDir: string;
  };
}

/**
 * Configuration options for the Ducklings Workers Vite plugin.
 */
export interface DucklingsWorkersPluginOptions {
  /**
   * Name of the WASM file in the output directory.
   * @default 'duckdb-workers.wasm'
   */
  wasmFileName?: string;
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
 * - Copies the WASM file to the output directory after the bundle is written
 *
 * Designed to work with @cloudflare/vite-plugin. The plugin detects the actual
 * output directory structure created by the Cloudflare plugin and places the
 * WASM file in the correct location.
 *
 * @param options - Plugin configuration options
 * @returns Vite plugin
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { cloudflare } from '@cloudflare/vite-plugin';
 * import { ducklingsWorkerPlugin } from '@ducklings/workers/vite-plugin';
 *
 * export default defineConfig({
 *   plugins: [
 *     ducklingsWorkerPlugin(),
 *     cloudflare(),
 *   ],
 * });
 * ```
 */
export function ducklingsWorkerPlugin(options: DucklingsWorkersPluginOptions = {}): VitePlugin {
  const { wasmFileName = 'duckdb-workers.wasm' } = options;

  let projectRoot: string;
  let outDir: string;

  return {
    name: 'ducklings-workers-plugin',
    enforce: 'pre' as const,

    configResolved(config) {
      projectRoot = config.root;
      outDir = config.build.outDir;
    },

    // Resolve WASM imports from the package to relative path
    resolveId(id) {
      if (id === '@ducklings/workers/wasm') {
        // Return external reference that will be resolved at runtime by wrangler
        return { id: `./${wasmFileName}`, external: true as const };
      }
      return null;
    },

    // Copy WASM file after bundle is written - handles Cloudflare plugin's nested output
    writeBundle(options) {
      const wasmSrcPath = getWasmPath();
      const baseOutDir = resolve(projectRoot, outDir);

      // The Cloudflare vite plugin creates a nested structure like:
      // dist/{worker_name}/index.js
      // We need to find where index.js is and put the WASM file there
      let targetDir = options.dir || baseOutDir;

      // If options.dir is provided, use it directly
      if (options.dir) {
        targetDir = options.dir;
      } else {
        // Look for subdirectories that contain index.js (Cloudflare plugin structure)
        if (existsSync(baseOutDir)) {
          const entries = readdirSync(baseOutDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const potentialIndexPath = join(baseOutDir, entry.name, 'index.js');
              if (existsSync(potentialIndexPath)) {
                targetDir = join(baseOutDir, entry.name);
                break;
              }
            }
          }
        }
      }

      const wasmDestPath = join(targetDir, wasmFileName);

      try {
        mkdirSync(targetDir, { recursive: true });
        copyFileSync(wasmSrcPath, wasmDestPath);
        console.log(`[ducklings] WASM file written to ${wasmDestPath}`);
      } catch (e) {
        console.error('[ducklings] Failed to copy WASM file:', e);
      }
    },
  };
}

export default ducklingsWorkerPlugin;
