import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Resolve core from source: `pnpm -r test` runs the CLI's pretest build, which wipes
  // core's dist while other packages' tests are still importing it.
  resolve: {
    alias: [
      { find: /^@actalk\/inkos-core$/, replacement: source("../core/src/index.ts") },
    ],
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
