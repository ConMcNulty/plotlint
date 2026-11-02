// plotlint Studio desktop app: starts the Studio server for a project folder in
// a background process and shows Studio in a window.
"use strict";

const { app, BrowserWindow, Menu, dialog, nativeTheme, shell } = require("electron");
const { fork } = require("node:child_process");
const { appendFileSync, existsSync, mkdirSync } = require("node:fs");
const { basename, join, resolve } = require("node:path");
const { loadRecentProject, saveRecentProject, freePort, waitForServer, isAppUrl, tail } = require("./lib/support.cjs");

const APP_NAME = "plotlint Studio";
const serverDir = app.isPackaged ? join(process.resourcesPath, "server") : join(__dirname, "build", "server");
const serverEntry = join(serverDir, "plotlint-server.mjs");

let win = null;
let server = null; // { child, url, root, output }
let quitting = false;

function logFile() {
  const dir = app.getPath("logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, "server.log");
}

function log(line) {
  try {
    appendFileSync(logFile(), line.endsWith("\n") ? line : `${line}\n`);
  } catch {
    // logging must never take the app down
  }
}

function projectFromArgs(argv) {
  const i = argv.indexOf("--project");
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : undefined;
}

async function chooseProjectFolder(firstRun) {
  const options = {
    title: firstRun ? "Choose a folder for your writing" : "Open project folder",
    buttonLabel: "Open project",
    message: "Pick a plotlint project, or an empty folder to start a new one.",
    properties: ["openDirectory", "createDirectory", "promptToCreate"],
  };
  const parent = win && win.isVisible() ? win : null;
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  return result.canceled || !result.filePaths[0] ? undefined : result.filePaths[0];
}

// The app's icon, drawn inline so the loading screen needs no files.
const ICON_SVG = `<svg viewBox="0 0 512 512" width="88" height="88" aria-hidden="true">
<rect x="16" y="16" width="480" height="480" rx="104" fill="#8e2f2b"/>
<path d="M150 96h158l74 74v246a20 20 0 0 1-20 20H150a20 20 0 0 1-20-20V116a20 20 0 0 1 20-20z" fill="#fbf8f3"/>
<path d="M308 96v54a20 20 0 0 0 20 20h54z" fill="#e7ddd0"/>
<g stroke="#57534e" stroke-width="16" stroke-linecap="round"><line x1="176" y1="214" x2="336" y2="214"/>
<line x1="176" y1="262" x2="300" y2="262"/><line x1="176" y1="334" x2="320" y2="334"/></g>
<path class="squiggle" d="M176 296 q12 -14 24 0 t24 0 t24 0 t24 0 t24 0" fill="none" stroke="#d97706" stroke-width="10" stroke-linecap="round"/></svg>`;

// The loading screen: icon, name, what is happening and, while busy, a progress bar.
function statusPage(message, detail = "", { busy = true } = {}) {
  const html = `<!doctype html><meta charset="utf-8"><title>${APP_NAME}</title>
<style>
:root{--bg:#fafaf9;--fg:#292524;--muted:#78716c;--track:#e7e5e4;--accent:#8e2f2b}
@media(prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#e7e5e4;--muted:#a8a29e;--track:#292524;--accent:#d97757}}
html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px system-ui,"Segoe UI",sans-serif;user-select:none}
main{display:flex;flex-direction:column;align-items:center;gap:14px;max-width:80vw;text-align:center}
h1{font:600 22px/1.2 Georgia,"Times New Roman",serif;margin:4px 0 0}
p{margin:0}.detail{color:var(--muted);font-size:13px;word-break:break-all}
.bar{width:220px;height:3px;border-radius:2px;background:var(--track);overflow:hidden;margin-top:6px}
.bar::after{content:"";display:block;width:40%;height:100%;border-radius:2px;background:var(--accent);animation:slide 1.1s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
.squiggle{stroke-dasharray:140;animation:draw 1.6s ease-in-out infinite alternate}
@keyframes draw{from{stroke-dashoffset:140}to{stroke-dashoffset:0}}
@media(prefers-reduced-motion:reduce){.bar::after,.squiggle{animation:none}}
</style>
<main>${ICON_SVG}<h1>${APP_NAME}</h1><p>${escapeHtml(message)}</p>
${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ""}${busy ? '<div class="bar" role="progressbar"></div>' : ""}</main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function loadingPage(root) {
  return statusPage(`Opening ${basename(root)}…`, root);
}

// Loads a page; a load cut short by the next one (ERR_ABORTED) is not an error.
async function showPage(url) {
  if (!win || win.isDestroyed()) return;
  try {
    await win.loadURL(url);
  } catch (error) {
    if (error && error.code === "ERR_ABORTED") return;
    throw error;
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function stopServer() {
  if (!server) return;
  const { child } = server;
  server = null;
  child.removeAllListeners("exit");
  if (child.exitCode === null) child.kill();
}

async function startServer(root) {
  if (!existsSync(serverEntry)) {
    throw new Error(`The Studio server is missing (${serverEntry}). Run "npm run prepare-server" in the desktop folder.`);
  }
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = fork(serverEntry, [root], {
    cwd: root,
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", INKOS_STUDIO_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const current = { child, url, root, output: "", initialized: false };
  server = current;
  log(`\n=== ${new Date().toISOString()} starting Studio for ${root} on ${url}`);
  const capture = chunk => {
    const text = chunk.toString();
    current.output = (current.output + text).slice(-20_000);
    log(text);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("message", message => {
    if (message && message.type === "initialized") current.initialized = Boolean(message.initialized);
  });

  await waitForServer(url, { isAlive: () => child.exitCode === null && child.signalCode === null });

  child.on("exit", code => {
    if (quitting || server !== current) return;
    log(`Studio server exited with code ${code}`);
    server = null;
    void showServerError(root, new Error(`The Studio server stopped (exit code ${code}).`), current.output);
  });
  return current;
}

async function openProject(root) {
  stopServer();
  win.setTitle(`${APP_NAME} — ${basename(root)}`);
  await showPage(loadingPage(root));
  let started;
  try {
    started = await startServer(root);
  } catch (error) {
    const output = server?.output ?? "";
    stopServer();
    await showServerError(root, error, output);
    return;
  }
  saveRecentProject(root);
  app.addRecentDocument(root);
  // Open on the home screen. If no AI model is set up yet, Studio shows a popup
  // that explains why one is needed and links to the model settings.
  await showPage(`${started.url}/`);
}

async function showServerError(root, error, output) {
  if (!win || win.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(win, {
    type: "error",
    title: APP_NAME,
    message: `Studio could not open ${basename(root)}.`,
    detail: `${error.message}\n\n${tail(output, 15)}`.trim(),
    buttons: ["Try again", "Open another folder", "Quit"],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 0) return openProject(root);
  if (response === 1) return openOtherProject();
  app.quit();
}

async function openOtherProject() {
  const folder = await chooseProjectFolder(false);
  if (folder) await openProject(folder);
  else if (!server) app.quit();
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "&File",
      submenu: [
        { label: "Open Project Folder…", accelerator: "CmdOrCtrl+O", click: () => void openOtherProject() },
        {
          label: "Show Project Folder",
          click: () => { if (server) void shell.openPath(server.root); },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "&View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "&Help",
      submenu: [
        { label: "Open Server Log", click: () => void shell.openPath(logFile()) },
        {
          label: "Download the Latest Version",
          click: () => void shell.openExternal("https://github.com/ConMcNulty/plotlint/releases/latest"),
        },
        { label: "plotlint on GitHub", click: () => void shell.openExternal("https://github.com/ConMcNulty/plotlint") },
        { type: "separator" },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1917" : "#fafaf9",
    show: true,
    autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  void showPage(statusPage("Starting…"));
  // Keep "plotlint Studio — <project>" rather than the page's own title.
  win.on("page-title-updated", event => event.preventDefault());

  const appOrigin = () => (server ? new URL(server.url).origin : "");
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url, appOrigin())) return { action: "allow" };
    if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("data:") || isAppUrl(url, appOrigin())) return;
    event.preventDefault();
    if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url);
  });
  // Studio saves the manuscript as it goes, so a page's "leave this page?" check must never
  // stop the window closing: Electron would otherwise cancel the close without asking.
  win.webContents.on("will-prevent-unload", event => event.preventDefault());
  win.on("closed", () => { win = null; });
}

function fatal(what, error) {
  const text = error && error.stack ? error.stack : String(error);
  log(`${what}: ${text}`);
  dialog.showErrorBox(APP_NAME, `${what}.\n\n${text}\n\nDetails are in ${logFile()}`);
}

process.on("uncaughtException", error => fatal("Unexpected error", error));
process.on("unhandledRejection", error => fatal("Unexpected error", error));

if (!app.requestSingleInstanceLock()) {
  // Another copy is already running; it brings its window to the front.
  app.quit();
} else {
  app.setName(APP_NAME);
  if (process.platform === "win32") app.setAppUserModelId("com.plotlint.studio");

  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    log(`\n=== ${new Date().toISOString()} ${APP_NAME} ${app.getVersion()} starting (${process.platform}, Electron ${process.versions.electron})`);
    buildMenu();
    createWindow();
    const fromArgs = projectFromArgs(process.argv);
    const recent = fromArgs ? undefined : loadRecentProject();
    let root = fromArgs ?? recent;
    if (root) {
      log(`Project from ${fromArgs ? "--project" : "the last session"}: ${root}`);
    } else {
      log("No recent project; asking for a folder");
      await showPage(statusPage("Choose a folder for your writing", "Pick a plotlint project, or an empty folder to start a new one.", { busy: false }));
      root = await chooseProjectFolder(true);
    }
    if (!root) {
      log("No folder chosen; quitting");
      app.quit();
      return;
    }
    await openProject(root);
  }).catch(error => fatal("Startup failed", error));

  app.on("before-quit", () => { quitting = true; });
  app.on("will-quit", stopServer);
  app.on("window-all-closed", () => app.quit());
}
