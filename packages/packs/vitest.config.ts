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
      { find: /^@plotlint\/diagnostics\/node$/, replacement: source("../diagnostics/src/node.ts") },
      { find: /^@plotlint\/diagnostics\/verdicts$/, replacement: source("../diagnostics/src/verdicts.ts") },
      { find: /^@plotlint\/rules\/node$/, replacement: source("../rules/src/node.ts") },
      { find: /^@plotlint\/rules$/, replacement: source("../rules/src/index.ts") },
      { find: /^@plotlint\/style\/node$/, replacement: source("../style/src/node.ts") },
      { find: /^@plotlint\/style$/, replacement: source("../style/src/index.ts") },
    ],
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
