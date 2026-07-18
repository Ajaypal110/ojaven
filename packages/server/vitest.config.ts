import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // Real Neon round-trips from a distant region — generous timeouts,
    // and serialized files so shared-DB tests can't interleave.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      // Workspace packages export raw .ts; resolve them to source so
      // vitest transforms them (plain node can't import them, as the
      // earlier verify-*.mjs scripts demonstrated).
      "@ojaven/db/transactionClient": path.resolve(__dirname, "../db/src/transactionClient.ts"),
      "@ojaven/db": path.resolve(__dirname, "../db/src/index.ts"),
      "@ojaven/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
