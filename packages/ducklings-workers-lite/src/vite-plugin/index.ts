/**
 * Vite plugin for @ducklings/workers-lite on Cloudflare Workers.
 *
 * Resolves `@ducklings/workers-lite/wasm` and copies the non-Asyncify
 * `duckdb.wasm` beside the Worker bundle.
 *
 * @packageDocumentation
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface VitePlugin {
  name: string;
  enforce?: 'pre' | 'post';
  configResolved?: (config: ResolvedConfig) => void;
  resolveId?: (id: string) => { id: string; external: true } | null;
  writeBundle?: (options: { dir?: string }, bundle: Record<string, unknown>) => void;
}

interface ResolvedConfig {
  root: string;
  build: { outDir: string };
}

export interface DucklingsWorkersLitePluginOptions {
  /** @default 'duckdb.wasm' */
  wasmFileName?: string;
}

export function getWasmPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, 'wasm', 'duckdb.wasm');
}

export function ducklingsWorkerLitePlugin(
  options: DucklingsWorkersLitePluginOptions = {},
): VitePlugin {
  const { wasmFileName = 'duckdb.wasm' } = options;
  let projectRoot: string;
  let outDir: string;

  return {
    name: 'ducklings-workers-lite-plugin',
    enforce: 'pre',
    configResolved(config) {
      projectRoot = config.root;
      outDir = config.build.outDir;
    },
    resolveId(id) {
      if (id === '@ducklings/workers-lite/wasm') {
        return { id: `./${wasmFileName}`, external: true as const };
      }
      return null;
    },
    writeBundle(bundleOptions) {
      const wasmSrcPath = getWasmPath();
      const baseOutDir = resolve(projectRoot, outDir);
      let targetDir = bundleOptions.dir || baseOutDir;
      if (!bundleOptions.dir && existsSync(baseOutDir)) {
        for (const entry of readdirSync(baseOutDir, { withFileTypes: true })) {
          if (entry.isDirectory() && existsSync(join(baseOutDir, entry.name, 'index.js'))) {
            targetDir = join(baseOutDir, entry.name);
            break;
          }
        }
      }
      try {
        mkdirSync(targetDir, { recursive: true });
        copyFileSync(wasmSrcPath, join(targetDir, wasmFileName));
        console.log(`[ducklings-lite] WASM written to ${join(targetDir, wasmFileName)}`);
      } catch (error) {
        console.error('[ducklings-lite] Failed to copy WASM:', error);
      }
    },
  };
}

export default ducklingsWorkerLitePlugin;
