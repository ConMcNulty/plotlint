// Runs inside the desktop app's server process (Electron's own Node, started
// with ELECTRON_RUN_AS_NODE). prepare-server.mjs copies this file next to the
// deployed CLI, so the imports below resolve to the deployed packages.
//
//   plotlint-server.mjs <projectRoot>   (port from INKOS_STUDIO_PORT)
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? process.cwd());
const port = Number.parseInt(process.env.INKOS_STUDIO_PORT ?? "4567", 10);

// The app talks to this process over IPC; if the app goes away (even a crash),
// stop instead of leaving a server running.
process.on("disconnect", () => process.exit(0));

const load = (path) => import(pathToFileURL(join(here, path)).href);

const { ensureProjectDirectoryInitialized } = await load("dist/project-bootstrap.js");
const { startStudioServer } = await load("node_modules/@actalk/inkos-studio/dist/api/server.js");

const initialized = await ensureProjectDirectoryInitialized(root, { language: "en" });
if (initialized) console.log(`Started a new plotlint project in ${root}`);
process.send?.({ type: "initialized", initialized });

await startStudioServer(root, port, {
  staticDir: join(here, "node_modules", "@actalk", "inkos-studio", "dist"),
  hostname: "127.0.0.1",
});
