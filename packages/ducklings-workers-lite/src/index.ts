import { type InitOptions, init as initShared } from '../../ducklings-workers-shared/src/index';

/**
 * The lite build uses the non-Asyncify browser WASM (25 MB instead of the
 * 51 MB Asyncify Workers build). It reads registered buffers and Parquet files
 * that are already on the DuckDB filesystem; it has no httpfs.
 */
export type LiteInitOptions = Omit<InitOptions, 'moduleFactory'>;

export const init = (options: LiteInitOptions): Promise<void> =>
  initShared({
    ...options,
    moduleFactory: async (config) => {
      const glue = await import('./wasm/duckdb.js');
      return glue.default(config);
    },
  });

export * from '../../ducklings-workers-shared/src/index';
