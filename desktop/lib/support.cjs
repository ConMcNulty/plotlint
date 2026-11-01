// Helpers for main.cjs that do not need Electron, so plain Node tests can cover them.
"use strict";

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:net");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");

// Same file `inkos studio` uses, so the app and the CLI share the last project.
const RECENT_PROJECT_FILE = join(homedir(), ".inkos", "studio-project.json");

function loadRecentProject(file = RECENT_PROJECT_FILE) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    if (typeof parsed.projectRoot !== "string" || !parsed.projectRoot.trim()) return undefined;
    const root = resolve(parsed.projectRoot);
    return existsSync(join(root, "inkos.json")) ? root : undefined;
  } catch {
    return undefined;
  }
}

function saveRecentProject(root, file = RECENT_PROJECT_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ projectRoot: resolve(root) }, null, 2), "utf-8");
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

// Resolves once the Studio API answers; rejects after `timeoutMs` or when
// `isAlive()` turns false (the server process died).
async function waitForServer(url, { timeoutMs = 60_000, intervalMs = 150, isAlive = () => true } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!isAlive()) throw new Error("The Studio server stopped before it was ready.");
    try {
      const response = await fetch(`${url}/api/v1/project`);
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`The Studio server did not answer within ${Math.round(timeoutMs / 1000)}s.`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// Links to anything other than the local Studio open in the user's browser.
function isAppUrl(target, appOrigin) {
  try {
    return new URL(target).origin === appOrigin;
  } catch {
    return false;
  }
}

function tail(text, lines = 20) {
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
}

module.exports = { RECENT_PROJECT_FILE, loadRecentProject, saveRecentProject, freePort, waitForServer, isAppUrl, tail };
