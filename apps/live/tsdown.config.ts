import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { start: "src/start.ts", "document-conversion-worker": "src/document-conversion-worker.ts" },
  outDir: "dist",
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: false,
  exports: true,
});
