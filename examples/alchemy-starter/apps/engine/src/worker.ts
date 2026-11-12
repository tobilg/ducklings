import { handleRequest } from "./handlers";
import type { Env } from "./env";

/**
 * The Worker entry. `assets.runWorkerFirst: ["/api/*"]` in the Alchemy stack
 * sends only the API routes here; every other path is served by the static
 * asset layer, so the SPA never invokes the Worker.
 */
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
