// plotlint Studio desktop app: starts the Studio server for a project folder in
// a background process and shows Studio in a window.
"use strict";

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
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

function loadingPage(root) {
  const html = `<!doctype html><meta charset="utf-8"><title>${APP_NAME}</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#fafaf9;color:#44403c;
font:15px system-ui,sans-serif}@media(prefers-color-scheme:dark){body{background:#1c1917;color:#d6d3d1}}
p{margin:.3em 0;text-align:center}small{opacity:.6}</style>
<div><p>Opening ${escapeHtml(basename(root))}…</p><p><small>${escapeHtml(root)}</small></p></div>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
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
  await win.loadURL(loadingPage(root));
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
  // A new project needs a model before the agent can write, as `inkos studio` does.
  await win.loadURL(`${started.url}/${started.initialized ? "#/services" : ""}`);
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
    backgroundColor: "#fafaf9",
    show: false,
    autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());
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
  win.on("closed", () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
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
    buildMenu();
    createWindow();
    const root = projectFromArgs(process.argv) ?? loadRecentProject() ?? await chooseProjectFolder(true);
    if (!root) {
      app.quit();
      return;
    }
    await openProject(root);
  });

  app.on("before-quit", () => { quitting = true; });
  app.on("will-quit", stopServer);
  app.on("window-all-closed", () => app.quit());
}
