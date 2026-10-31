import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // CLI integration tests spawn real child processes; the default 5s timeout
    // is too aggressive when the whole workspace runs in parallel.
    testTimeout: 60_000,
    // Their beforeEach hooks run `inkos init` in a child process too, which can
    // pass the default 10s hook timeout on a slow Windows runner.
    hookTimeout: 60_000,
  },
});
