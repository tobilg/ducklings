/**
 * The Worker's runtime environment, expressed structurally so the same file
 * type-checks in the Vite app (which has DOM types) and under workerd.
 */
export interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

export type DatasetSource = "auto" | "r2" | "http";

export interface Env {
  /** Bound by `Cloudflare.Website.Vite` in packages/deploy/alchemy.run.ts. */
  readonly BUCKET?: R2Bucket;
  /** Object prefix the seed script writes under. */
  readonly DATASET_PREFIX?: string;
  /**
   * `auto` reads R2 first and falls back to the public TPC-H mirror, so local
   * dev works before `bun run seed`. `r2` and `http` pin one source.
   */
  readonly DATASET_SOURCE?: DatasetSource;
}
