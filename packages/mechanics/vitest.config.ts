import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    // Resolve workspace deps to source, like studio does: in `pnpm -r test` the CLI's
    // pretest rebuilds core, diagnostics and rules, emptying their dist mid-run.
    alias: {
      "@actalk/inkos-core": resolve(__dirname, "../core/src/index.ts"),
      "@plotlint/diagnostics": resolve(__dirname, "../diagnostics/src/index.ts"),
      "@plotlint/rules": resolve(__dirname, "../rules/src/index.ts"),
    },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    // Loading core from source and Harper's WebAssembly can be slow on a cold run.
    testTimeout: 30_000,
  },
});
