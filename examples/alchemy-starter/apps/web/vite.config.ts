import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

// `alchemy dev` / `alchemy deploy` inject their own Cloudflare Vite plugin
// (ALCHEMY_CLOUDFLARE_VITE_INJECTED=1). Loading a second one alongside it
// yields two same-named plugin stacks, only one of which is provisioned with
// the Worker bindings — so only add ours when running `vite` directly.
const alchemyInjected = process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1";

export default defineConfig({
  plugins: [
    ...(alchemyInjected
      ? []
      : [
          cloudflare({
            viteEnvironment: { name: "ssr" },
            // Alchemy supplies this from the `main` prop at deploy time; a
            // direct `vite build` needs it spelled out.
            config: {
              main: "worker/index.ts",
              compatibility_date: "2026-11-01",
            },
          }),
        ]),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [{ find: /^@\//, replacement: `${path.resolve(root, "src")}/` }],
  },
  server: {
    port: 5180,
    strictPort: true,
    // `dev:ui` runs Vite on 5183 for HMR and proxies API calls to the
    // `alchemy dev` Worker on 5180.
    proxy: { "/api": "http://127.0.0.1:5180" },
  },
});
