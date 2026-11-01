"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { loadRecentProject, saveRecentProject, freePort, waitForServer, isAppUrl, tail } = require("../lib/support.cjs");

test("recent project round-trips and needs inkos.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "plotlint-desktop-"));
  const file = join(dir, "cfg", "studio-project.json");
  const project = join(dir, "book");
  mkdirSync(project);
  assert.equal(loadRecentProject(file), undefined);
  saveRecentProject(project, file);
  assert.equal(loadRecentProject(file), undefined, "not a project yet");
  writeFileSync(join(project, "inkos.json"), "{}");
  assert.equal(loadRecentProject(file), project);
  writeFileSync(file, "not json");
  assert.equal(loadRecentProject(file), undefined);
});

test("freePort gives a usable port and waitForServer sees it answer", async () => {
  const port = await freePort();
  assert.ok(port > 0);
  const server = createServer((_req, res) => res.end("{}"));
  await new Promise(r => server.listen(port, "127.0.0.1", r));
  try {
    await waitForServer(`http://127.0.0.1:${port}`, { timeoutMs: 2000 });
  } finally {
    server.close();
  }
});

test("waitForServer gives up when the server process dies", async () => {
  const port = await freePort();
  await assert.rejects(waitForServer(`http://127.0.0.1:${port}`, { isAlive: () => false }), /stopped/);
  await assert.rejects(waitForServer(`http://127.0.0.1:${port}`, { timeoutMs: 200, intervalMs: 50 }), /did not answer/);
});

test("only the local Studio origin stays in the window", () => {
  assert.equal(isAppUrl("http://127.0.0.1:5000/#/book/x", "http://127.0.0.1:5000"), true);
  assert.equal(isAppUrl("http://127.0.0.1:5001/", "http://127.0.0.1:5000"), false);
  assert.equal(isAppUrl("https://github.com", "http://127.0.0.1:5000"), false);
  assert.equal(isAppUrl("nonsense", "http://127.0.0.1:5000"), false);
});

test("tail keeps the last lines", () => {
  assert.equal(tail("a\nb\n\nc\n", 2), "b\nc");
});
