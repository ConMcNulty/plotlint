import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // Subpath aliases must precede the bare package alias: a string alias also
      // matches `<key>/...`, so the bare entry would otherwise swallow these.
      // The app/build resolves these subpaths via core's package.json "exports"
      // (browser-safe, zod-only); tests resolve them to source like the bare pkg.
      "@actalk/inkos-core/interactive-film/evaluator": resolve(__dirname, "../core/src/interactive-film/evaluator.ts"),
      "@actalk/inkos-core/interactive-film/graph-schema": resolve(__dirname, "../core/src/interactive-film/graph-schema.ts"),
      "@actalk/inkos-core/forecast/schema": resolve(__dirname, "../core/src/forecast/schema.ts"),
      "@actalk/inkos-core/llm/api-format": resolve(__dirname, "../core/src/llm/api-format.ts"),
      "@actalk/inkos-core": resolve(__dirname, "../core/src/index.ts"),
      // plotlint packages also resolve to source: in `pnpm -r test` the CLI's pretest
      // rebuilds core, diagnostics and rules, emptying their dist mid-run.
      "@plotlint/diagnostics/node": resolve(__dirname, "../diagnostics/src/node.ts"),
      "@plotlint/diagnostics/verdicts": resolve(__dirname, "../diagnostics/src/verdicts.ts"),
      "@plotlint/diagnostics": resolve(__dirname, "../diagnostics/src/index.ts"),
      "@plotlint/provenance/node": resolve(__dirname, "../provenance/src/node.ts"),
      "@plotlint/provenance": resolve(__dirname, "../provenance/src/index.ts"),
      "@plotlint/export": resolve(__dirname, "../export/src/index.ts"),
      "@plotlint/rules/node": resolve(__dirname, "../rules/src/node.ts"),
      "@plotlint/rules/scenes": resolve(__dirname, "../rules/src/scenes.ts"),
      "@plotlint/rules": resolve(__dirname, "../rules/src/index.ts"),
      "@plotlint/mechanics": resolve(__dirname, "../mechanics/src/index.ts"),
      "@plotlint/metrics": resolve(__dirname, "../metrics/src/index.ts"),
      "@plotlint/packs/node": resolve(__dirname, "../packs/src/node.ts"),
      "@plotlint/packs": resolve(__dirname, "../packs/src/index.ts"),
      "@plotlint/style/node": resolve(__dirname, "../style/src/node.ts"),
      "@plotlint/style": resolve(__dirname, "../style/src/index.ts"),
      "@plotlint/editor/styles.css": resolve(__dirname, "../editor/styles.css"),
      "@plotlint/editor": resolve(__dirname, "../editor/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    // server.ts is large enough that first-load esbuild transforms can exceed
    // Vitest's default 5s timeout on a cold full-suite run.
    testTimeout: 30_000,
  },
});
