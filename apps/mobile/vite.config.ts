import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
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
  build: { target: "chrome95", sourcemap: false },
});
