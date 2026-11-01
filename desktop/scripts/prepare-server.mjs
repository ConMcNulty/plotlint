// Lays out the Studio server that the desktop app ships, in desktop/build/server:
//
//   plotlint-server.mjs   server-entry.mjs and everything it imports, in one file
//   web/                  the Studio page (the studio package's built client)
//   resources/            data files the bundled packages read at run time
//   node_modules/         only harper.js (it loads its WebAssembly beside itself) and its dependency
//
// One bundle instead of ~20,000 files in node_modules: on Windows, loading
// that many files (and virus-scanning them) made the app very slow to start.
//
// Run `pnpm install` and `pnpm build` at the repo root first.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(desktop, "..");
const deployed = join(desktop, "build", "deploy");
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

// 1. The built CLI (which depends on Studio and every plotlint package) with
//    its production dependencies in a flat node_modules, for esbuild to read.
rmSync(deployed, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });
// The lockfile is pnpm 9's (as in CI), so run that version whatever is installed.
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(
  npx,
  ["-y", "pnpm@9.15.9", "--filter", "@actalk/inkos", "deploy", "--prod", "--config.node-linker=hoisted", deployed],
  { cwd: repo, stdio: "inherit", shell: process.platform === "win32" },
);
const modules = join(deployed, "node_modules");

// 2. Packages that find their data files next to their own code. In the
//    bundle that code sits in plotlint-server.mjs, so point each one at its
//    copy under resources/.
const resources = [
  { file: "@actalk/inkos-core/dist/skills/builtin-loader.js", from: '"../../skills"', to: '"./resources/core-skills"', name: "core-skills", dir: "@actalk/inkos-core/skills" },
  { file: "@plotlint/style/dist/node.js", from: '"../packs/"', to: '"./resources/style-packs/"', name: "style-packs", dir: "@plotlint/style/packs" },
  { file: "@plotlint/packs/dist/node.js", from: '"../packs/"', to: '"./resources/check-packs/"', name: "check-packs", dir: "@plotlint/packs/packs" },
];
const relocate = {
  name: "relocate-data-files",
  setup(builder) {
    for (const entry of resources) {
      const path = join(modules, entry.file);
      builder.onLoad({ filter: /\.js$/ }, args => {
        if (resolve(args.path) !== resolve(path)) return undefined;
        const source = readFileSync(path, "utf-8");
        if (!source.includes(entry.from)) throw new Error(`${entry.file} no longer contains ${entry.from}; update prepare-server.mjs.`);
        return { contents: source.replaceAll(entry.from, entry.to), loader: "js" };
      });
    }
  },
};

// 3. One ESM file. harper.js stays outside: it loads its .wasm from its own folder.
await build({
  entryPoints: [join(desktop, "server-entry.mjs")],
  outfile: join(out, "plotlint-server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  legalComments: "linked",
  nodePaths: [modules],
  alias: { "@actalk/inkos": deployed },
  external: ["harper.js", "harper.js/*"],
  // Bundled CommonJS packages call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __plotlintCreateRequire } from 'node:module'; const require = __plotlintCreateRequire(import.meta.url);" },
  plugins: [relocate],
  logLevel: "warning",
});

for (const { name, dir } of resources) {
  cpSync(join(modules, dir), join(out, "resources", name), { recursive: true });
}
for (const name of ["harper.js", "fflate"]) {
  cpSync(join(modules, name), join(out, "node_modules", name), { recursive: true, dereference: true });
}
// Harper's slim inlined build is never loaded (mechanics uses binary or binaryInlined).
rmSync(join(out, "node_modules", "harper.js", "dist", "slimBinaryInlined.js"), { force: true });
rmSync(join(out, "node_modules", "harper.js", "dist", "slimBinaryInlined.d.ts"), { force: true });
cpSync(join(modules, "@actalk", "inkos-studio", "dist"), join(out, "web"), {
  recursive: true,
  filter: source => !/[\\/]dist[\\/](api|lib|shared)([\\/]|$)/.test(source),
});
cpSync(join(repo, "LICENSE"), join(out, "LICENSE"));
rmSync(deployed, { recursive: true, force: true });
console.log(`Studio server ready in ${out}`);
