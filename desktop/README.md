# plotlint Studio desktop app

An Electron shell around Studio. It starts the Studio server for a project
folder in a background process (Electron's own Node, so nothing else needs to
be installed) and shows Studio in its own window.

- On first launch it asks for a folder. Pick an existing project, or an empty
  folder to start a new one (it then opens model setup, as `inkos studio` does).
- After that it reopens the last project. It shares that memory with
  `inkos studio` (`~/.inkos/studio-project.json`).
- **File → Open Project Folder…** (Ctrl+O) switches projects.
- **Help → Open Server Log** shows the server's output if something goes wrong.
- Links to other sites open in your browser.

## Getting the app

Every push to `master` builds it on GitHub's Windows runners, checks the
packaged app, and publishes a GitHub Release tagged `studio-v<version>`
(`desktop/package.json`'s major.minor plus the workflow run number). Download
it from the repo's [latest release](https://github.com/ConMcNulty/plotlint/releases/latest),
or from Help → Download the Latest Version in the app. Each release (and each
PR run's `plotlint-Studio-windows` artifact) holds:

- `plotlint-Studio-Setup-<version>.exe`, an installer (per user, no admin), and
- `plotlint-Studio-<version>-portable.exe`, which runs without installing.

The exes are not code-signed, so Windows SmartScreen warns the first time:
choose **More info → Run anyway**.

To build on your own PC instead (Node 22+ and git):

    powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1

## Layout

- `main.cjs` — the Electron main process (window, menu, server lifecycle).
- `lib/support.cjs` — helpers with Node-only tests in `test/`.
- `server-entry.mjs` — runs in the server process; creates the project if the
  folder is empty and starts the Studio server.
- `scripts/prepare-server.mjs` — `pnpm deploy`s the built CLI (with Studio and
  every plotlint package) into `build/server` with a flat `node_modules`.
- `scripts/after-pack.cjs` — copies `build/server` into the app's resources
  (electron-builder drops `node_modules` from `extraResources`).
- `scripts/smoke.mjs` — launches the packaged app on a project and checks
  Studio loads, linting works, and the server stops with the app.

Development, after `pnpm install && pnpm build` at the repo root:

    cd desktop
    npm install
    npm run prepare-server
    npm start -- --project <folder>

This package is outside the pnpm workspace on purpose, so Electron is only
downloaded when the desktop app is built.
