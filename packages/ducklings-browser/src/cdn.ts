/**
 * CDN utilities for loading DuckDB from CDNs like jsDelivr
 *
 * When loading the library from a CDN, browsers block cross-origin Worker creation.
 * Use {@link createWorker} to work around this limitation.
 *
 * @packageDocumentation
 */

import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

/**
 * Bundle URLs for loading from CDN
 *
 * @category CDN
 */
export interface DuckDBBundle {
  /** URL to the main library entry point */
  mainModule: string;
  /** URL to the worker script */
  mainWorker: string;
  /** URL to the WASM binary */
  wasmModule: string;
  /** URL to the Emscripten JS glue */
  wasmJs: string;
}

/**
 * Get pre-configured bundle URLs for loading from jsDelivr CDN
 *
 * @category CDN
 * @param version - Optional version to use (defaults to current package version)
 * @returns Bundle URLs for jsDelivr
 *
 * @example
 * ```typescript
 * import { getJsDelivrBundle, createWorker, init } from '@ducklings/browser';
 *
 * const bundle = getJsDelivrBundle();
 * const worker = await createWorker(bundle.mainWorker);
 *
 * await init({
 *   worker,
 *   wasmUrl: bundle.wasmModule,
 *   wasmJsUrl: bundle.wasmJs,
 * });
 * ```
 */
export function getJsDelivrBundle(version?: string): DuckDBBundle {
  const ver = version ?? PACKAGE_VERSION;
  const base = `https://cdn.jsdelivr.net/npm/${PACKAGE_NAME}@${ver}/dist/`;

  return {
    mainModule: `${base}index.js`,
    mainWorker: `${base}worker.js`,
    wasmModule: `${base}wasm/duckdb.wasm`,
    wasmJs: `${base}wasm/duckdb.js`,
  };
}

/**
 * Get pre-configured bundle URLs for loading from unpkg CDN
 *
 * @category CDN
 * @param version - Optional version to use (defaults to current package version)
 * @returns Bundle URLs for unpkg
 */
export function getUnpkgBundle(version?: string): DuckDBBundle {
  const ver = version ?? PACKAGE_VERSION;
  const base = `https://unpkg.com/${PACKAGE_NAME}@${ver}/dist/`;

  return {
    mainModule: `${base}index.js`,
    mainWorker: `${base}worker.js`,
    wasmModule: `${base}wasm/duckdb.wasm`,
    wasmJs: `${base}wasm/duckdb.js`,
  };
}

/**
 * Create a Worker from a cross-origin URL using Blob URL workaround.
 *
 * Browsers block creating Workers from cross-origin scripts (like those served from CDNs).
 * This function fetches the worker script and creates a same-origin Blob URL from it.
 *
 * @category CDN
 * @param url - URL to the worker script (can be cross-origin)
 * @returns Promise resolving to a same-origin Worker
 *
 * @example
 * ```typescript
 * import { createWorker, getJsDelivrBundle, init } from '@ducklings/browser';
 *
 * const bundle = getJsDelivrBundle();
 * const worker = await createWorker(bundle.mainWorker);
 *
 * await init({ worker });
 * ```
 */
export async function createWorker(url: string): Promise<Worker> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch worker script: ${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  return new Worker(blobUrl, { type: 'module' });
}
