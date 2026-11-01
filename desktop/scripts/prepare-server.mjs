// Lays out the Studio server that the desktop app ships, in desktop/build/server:
// the built CLI package with all its production dependencies (flat
// node_modules, no symlinks) plus plotlint-server.mjs.
//
// Run `pnpm install` and `pnpm build` at the repo root first.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(desktop, "..");
const out = join(desktop, "build", "server");

for (const built of [
  "packages/cli/dist/index.js",
  "packages/studio/dist/index.html",
  "packages/studio/dist/api/server.js",
]) {
  if (!existsSync(join(repo, built))) {
    console.error(`Missing ${built}. Run "pnpm install" and "pnpm build" in ${repo} first.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });

// The lockfile is pnpm 9's (as in CI), so run that version whatever is installed.
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(
  npx,
  ["-y", "pnpm@9.15.9", "--filter", "@actalk/inkos", "deploy", "--prod", "--config.node-linker=hoisted", out],
  { cwd: repo, stdio: "inherit", shell: process.platform === "win32" },
);

// Command shims are not needed in the app and are symlinks on Linux/macOS.
rmSync(join(out, "node_modules", ".bin"), { recursive: true, force: true });
copyFileSync(join(desktop, "server-entry.mjs"), join(out, "plotlint-server.mjs"));
console.log(`Studio server ready in ${out}`);
