import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createWorkManifest, saveRuntimeStateSnapshot, saveWorkManifest } from "@actalk/inkos-core";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(testDir, "..", "..", "dist", "index.js");

describe("inkos lint export", () => {
  let projectDir: string;
  let bookDir: string;
  let server: Server;
  const env = () => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INKOS_") && !/^https?_proxy$/iu.test(key))),
    HOME: projectDir,
    PLOTLINT_TEST_KEY: "test-key",
  });

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-export-"));
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const system = (JSON.parse(body) as { messages: Array<{ content: string }> }).messages[0]!.content;
        const content = system.includes("synopsis") ? "Nell returns to the fen and meets Inspector Grady. In the end Pell confesses." : "Dear [Agent name],\n\nFen is a complete 100-word mystery novel.";
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          id: "x", object: "chat.completion", created: 0, model: "mock",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    execFileSync("node", [cliEntry, "init"], { cwd: projectDir, env: env(), encoding: "utf-8", timeout: 15_000 });
    await saveWorkManifest(projectDir, createWorkManifest({ id: "fen", title: "Fen", profileId: "longform-novel", language: "en" }));
    bookDir = new StateManager(projectDir).bookDir("fen");
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0001_one.md"), "# Chapter 1: The Gate\n\nNell reached the gate.\n\n***\n\nPell waited by the mill.\n");
    await writeFile(join(bookDir, "chapters", "0002_two.md"), "# Chapter 2\n\nThe box was gone.\n");
  });

  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(projectDir, { recursive: true, force: true });
  });

  const inkos = (...args: string[]) => new Promise<{ stdout: string; stderr: string; code: number | null }>((done) => {
    const { port } = server.address() as AddressInfo;
    const child = spawn("node", [
      cliEntry, "--service", "custom", "--base-url", `http://127.0.0.1:${port}/v1`, "--api-format", "chat",
      "--model", "mock", "--no-stream", "--api-key-env", "PLOTLINT_TEST_KEY", "lint", "export", ...args,
    ], { cwd: projectDir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => done({ stdout, stderr, code }));
  });

  it("writes a manuscript and a submission package", async () => {
    expect((await inkos("manuscript", "fen")).code).toBe(1);
    const manuscript = await inkos("manuscript", "fen", "--author", "Cob Example", "--contact", "cob@example.com", "--output", join(projectDir, "fen.docx"));
    expect(manuscript.code).toBe(0);
    expect(manuscript.stdout).toContain("manuscript: 2 chapters, 13 words");
    expect((await readFile(join(projectDir, "fen.docx"))).subarray(0, 2).toString()).toBe("PK");

    // No summaries yet: only the outline and provenance without the LLM.
    expect((await inkos("submission", "fen")).code).toBe(1);
    expect((await inkos("submission", "fen", "--outline-only")).code).toBe(0);

    await saveRuntimeStateSnapshot(bookDir, {
      manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 2, projectionVersion: 1 },
      currentState: { chapter: 2, facts: [{ subject: "Nell", predicate: "location", object: "the mill gate", validFromChapter: 1, validUntilChapter: null, sourceChapter: 1 }] },
      hooks: { hooks: [] },
      chapterSummaries: { rows: [
        { chapter: 1, title: "The Gate", characters: "Nell, Pell", events: "Nell reaches the gate; Pell waits.", stateChanges: "", hookActivity: "box: planted", mood: "calm", chapterType: "setup" },
        { chapter: 2, title: "The Box", characters: "Nell", events: "The box is gone.", stateChanges: "", hookActivity: "box: advanced", mood: "tense", chapterType: "turn" },
      ] },
    });
    const run = await inkos("submission", "fen", "--author", "Cob Example", "--genre", "mystery");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("synopsis: check these names, which the book never uses: Grady, Inspector");
    const dir = join(projectDir, "fen-submission");
    expect((await readdir(dir)).sort()).toEqual(["manuscript.docx", "outline.md", "provenance.md", "query.md", "synopsis.md"]);
    expect(await readFile(join(dir, "outline.md"), "utf-8")).toContain("## Chapter 2: The Box");
    expect(await readFile(join(dir, "synopsis.md"), "utf-8")).toContain("Draft: written by a model");
    expect(await readFile(join(dir, "provenance.md"), "utf-8")).toContain("unknown 100%");
  }, 90_000);
});
