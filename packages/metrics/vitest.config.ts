import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Resolve workspace deps from source: `pnpm -r test` runs the CLI's pretest build, which
  // wipes their dist folders while other packages' tests are still importing them.
  resolve: {
    alias: [
      { find: /^@actalk\/inkos-core$/, replacement: source("../core/src/index.ts") },
      { find: /^@plotlint\/diagnostics$/, replacement: source("../diagnostics/src/index.ts") },
      { find: /^@plotlint\/rules$/, replacement: source("../rules/src/index.ts") },
    ],
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
