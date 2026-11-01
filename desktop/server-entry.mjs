// Runs inside the desktop app's server process (Electron's own Node, started
// with ELECTRON_RUN_AS_NODE). prepare-server.mjs bundles this file and
// everything it imports into one file, server/plotlint-server.mjs, because
// loading ~20,000 separate files made the app slow to start on Windows.
//
//   plotlint-server.mjs <projectRoot>   (port from INKOS_STUDIO_PORT)
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureProjectDirectoryInitialized } from "@actalk/inkos/dist/project-bootstrap.js";
import { startStudioServer } from "@actalk/inkos-studio/dist/api/server.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? process.cwd());
const port = Number.parseInt(process.env.INKOS_STUDIO_PORT ?? "4567", 10);

// The app talks to this process over IPC; if the app goes away (even a crash),
// stop instead of leaving a server running.
process.on("disconnect", () => process.exit(0));

const initialized = await ensureProjectDirectoryInitialized(root, { language: "en" });
if (initialized) console.log(`Started a new plotlint project in ${root}`);
process.send?.({ type: "initialized", initialized });

await startStudioServer(root, port, {
  staticDir: join(here, "web"),
  hostname: "127.0.0.1",
});
