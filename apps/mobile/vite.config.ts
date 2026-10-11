import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import postcss from "postcss";
import cascadeLayers from "@csstools/postcss-cascade-layers";

export default defineConfig({
  plugins: [
    {
      name: "mobile-cascade-layer-compatibility",
      apply: "build",
      enforce: "post",
      async generateBundle(_options, bundle) {
        // Layer specificity must be calculated across the entire stylesheet, not per source file.
        for (const asset of Object.values(bundle)) {
          if (asset.type !== "asset" || !asset.fileName.endsWith(".css")) continue;
          const source = typeof asset.source === "string" ? asset.source : Buffer.from(asset.source).toString("utf8");
          const result = await postcss([cascadeLayers()]).process(source, { from: undefined, map: false });
          result.root.walkAtRules("layer", () => {
            throw new Error("Mobile CSS contains an uncompiled cascade layer");
          });
          asset.source = result.css;
        }
      },
    },
  ],
  base: "./",
  define: { "process.env": "{}" },
  resolve: {
    alias: {
      "@plane/shared-state/mobile": fileURLToPath(
        new URL("../../packages/shared-state/src/mobile.store.ts", import.meta.url)
      ),
    },
  },
  server: {
    hmr: process.env.MOBILE_TEST_FROZEN ? false : undefined,
    watch: process.env.MOBILE_TEST_FROZEN ? { ignored: ["**/*"] } : undefined,
    proxy: {
      "/api": {
        target: process.env.MOBILE_TEST_SERVER || "http://127.0.0.1:18100",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => {
            const origin = process.env.MOBILE_TEST_SERVER || "http://127.0.0.1:18100";
            req.setHeader("Origin", origin);
            req.setHeader("Referer", `${origin}/`);
          });
        },
      },
      "/auth": {
        target: process.env.MOBILE_TEST_SERVER || "http://127.0.0.1:18100",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => {
            const origin = process.env.MOBILE_TEST_SERVER || "http://127.0.0.1:18100";
            req.setHeader("Origin", origin);
            req.setHeader("Referer", `${origin}/`);
          });
        },
      },
      "/live": { target: process.env.MOBILE_TEST_SERVER || "http://127.0.0.1:18100", ws: true, changeOrigin: true },
    },
  },
  build: { target: "chrome95", sourcemap: false, cssCodeSplit: false },
});
