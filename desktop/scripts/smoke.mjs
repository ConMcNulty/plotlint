// Starts the packaged app on a project, checks that Studio loads and the lint
// API answers, then kills the app and checks the server went with it.
//
//   node scripts/smoke.mjs <project-dir>
// Run after `npm run dist` (Windows) or `npm run dist:dir` (Linux, under xvfb-run).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = resolve(process.argv[2] ?? "");
const exe = process.platform === "win32"
  ? join(desktop, "release", "win-unpacked", "plotlint Studio.exe")
  : join(desktop, "release", "linux-unpacked", "plotlint-studio");
if (!existsSync(exe)) throw new Error(`No packaged app at ${exe}`);

const debugPort = 9333;
const args = [`--remote-debugging-port=${debugPort}`, "--project", project];
if (process.platform === "linux") args.unshift("--no-sandbox");
const startedAt = Date.now();
const app = spawn(exe, args, { stdio: "inherit" });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function studioOrigin() {
  for (let i = 0; i < 240; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const studio = pages.find(page => page.type === "page" && page.url.startsWith("http://127.0.0.1:"));
      if (studio) return new URL(studio.url).origin;
    } catch {
      // app still starting
    }
    if (app.exitCode !== null) throw new Error(`The app exited early (code ${app.exitCode}).`);
    await sleep(500);
  }
  throw new Error("Studio did not load within 120s.");
}

let failed = false;
try {
  const origin = await studioOrigin();
  console.log(`Studio loaded at ${origin} ${((Date.now() - startedAt) / 1000).toFixed(1)}s after launch`);
  const books = await (await fetch(`${origin}/api/v1/books`)).json();
  console.log(`Books: ${JSON.stringify(books).slice(0, 200)}`);
  const response = await fetch(`${origin}/api/v1/plotlint/lint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId: "harbour-lights", chapter: 1, text: "She recieved the key." }),
  });
  const body = await response.text();
  let lint = {};
  try { lint = JSON.parse(body); } catch { /* reported below */ }
  const rules = (lint.diagnostics ?? []).map(d => d.ruleId);
  console.log(`Lint ${response.status}: ${rules.join(", ")}`);
  if (response.status !== 200 || !rules.includes("mechanics/harper")) throw new Error(`Lint did not flag the typo: ${body.slice(0, 2000)}`);

  app.kill("SIGKILL"); // as if the app crashed: the server must not outlive it
  await sleep(4000);
  const stillUp = await fetch(`${origin}/api/v1/project`).then(() => true, () => false);
  if (stillUp) throw new Error("The Studio server kept running after the app was killed.");
  console.log("Server stopped with the app.");
} catch (error) {
  failed = true;
  console.error(error);
  const log = process.platform === "win32"
    ? join(process.env.APPDATA ?? "", "plotlint Studio", "logs", "server.log")
    : join(homedir(), ".config", "plotlint Studio", "logs", "server.log");
  if (existsSync(log)) console.error(`--- server log (${log}) ---\n${readFileSync(log, "utf-8").slice(-6000)}`);
} finally {
  if (app.exitCode === null) app.kill("SIGKILL");
}
process.exit(failed ? 1 : 0);
