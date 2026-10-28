import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createWorkManifest, saveWorkManifest } from "@actalk/inkos-core";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(testDir, "..", "..", "dist", "index.js");

describe("inkos lint annotate progress", () => {
  let projectDir: string;
  let server: Server;
  let requests = 0;
  const env = () => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INKOS_") && !/^https?_proxy$/iu.test(key))),
    HOME: projectDir,
    PLOTLINT_TEST_KEY: "test-key",
  });

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-annotate-"));
    requests = 0;
    // A model that never gives a usable reply: the progress lines come before each call regardless.
    server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        requests++;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          id: "x", object: "chat.completion", created: 0, model: "mock",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Sorry, no JSON today." } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    execFileSync("node", [cliEntry, "init"], { cwd: projectDir, env: env(), encoding: "utf-8", timeout: 15_000 });
    await saveWorkManifest(projectDir, createWorkManifest({ id: "annotated", title: "Annotated", profileId: "longform-novel", language: "en" }));
    const bookDir = new StateManager(projectDir).bookDir("annotated");
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0001_one.md"), "# Chapter 1\n\nMira waited at the harbour steps until the tide turned.\n");
  });

  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(projectDir, { recursive: true, force: true });
  });

  const annotate = (...extra: string[]) => new Promise<{ stdout: string; stderr: string; code: number | null }>((done) => {
    const { port } = server.address() as AddressInfo;
    const child = spawn("node", [
      cliEntry, "--service", "custom", "--base-url", `http://127.0.0.1:${port}/v1`, "--api-format", "chat",
      "--model", "mock", "--no-stream", "--api-key-env", "PLOTLINT_TEST_KEY", "lint", "annotate", "annotated", ...extra,
    ], { cwd: projectDir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => done({ stdout, stderr, code }));
  });

  it("says which chapter it is annotating before each model call, on stderr with --json", async () => {
    const text = await annotate();
    expect(text.stdout).toContain("ch1: annotating 1 scene…");
    expect(text.stdout).toContain("ch1: reply unusable, asking again (attempt 2)…");
    expect(requests).toBeGreaterThanOrEqual(2);

    const json = await annotate("--json");
    expect(json.stderr).toContain("ch1: annotating 1 scene…");
    expect(JSON.parse(json.stdout)).toMatchObject({ bookId: "annotated", failed: [{ chapter: 1 }] });
  }, 60_000);
});
