/**
 * The web Worker is a thin proxy: it forwards `/api/*` to the engine Worker
 * over the `ENGINE` service binding and never touches DuckDB itself.
 *
 * Keeping the engine separate is what lets Alchemy upload the 50 MB WASM as a
 * sibling module (`bundle: false` + module rules) instead of re-bundling the
 * Vite output, which would drop the `.wasm` import.
 */
interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly ENGINE: { fetch(request: Request): Promise<Response> };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return env.ENGINE.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
