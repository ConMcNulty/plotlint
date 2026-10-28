import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createWorkManifest, saveWorkManifest } from "@actalk/inkos-core";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(testDir, "..", "..", "dist", "index.js");

const hook = (hookId: string, startChapter: number, lastAdvancedChapter: number, expectedPayoff: string) => ({
  hookId, startChapter, type: "mystery", status: "open", lastAdvancedChapter, expectedPayoff, notes: "",
});

describe("inkos lint hooks", () => {
  let projectDir: string;
  let bookDir: string;
  let server: Server;
  let prompts: string[] = [];
  const env = () => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INKOS_") && !/^https?_proxy$/iu.test(key))),
    HOME: projectDir,
    PLOTLINT_TEST_KEY: "test-key",
  });

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-hooks-"));
    prompts = [];
    // A model that says the lantern hook is answered in ch2 and the whistle hook is not.
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const messages = (JSON.parse(body) as { messages: Array<{ content: string }> }).messages;
        const prompt = messages.at(-1)!.content;
        prompts.push(prompt);
        const answer = /id: lantern/u.test(prompt)
          ? { answered: true, chapter: 2, quote: "Pell had hidden the lantern in the reeds", how: "Pell hid it" }
          : { answered: false, chapter: null, quote: null, how: "the whistle never returns" };
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          id: "x", object: "chat.completion", created: 0, model: "mock",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(answer) } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    execFileSync("node", [cliEntry, "init"], { cwd: projectDir, env: env(), encoding: "utf-8", timeout: 15_000 });
    await saveWorkManifest(projectDir, createWorkManifest({ id: "fen", title: "Fen", profileId: "longform-novel", language: "en" }));
    bookDir = new StateManager(projectDir).bookDir("fen");
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0001_one.md"), "# Chapter 1\n\nA lantern lay in the reeds. Nell found a silver whistle.\n");
    await writeFile(join(bookDir, "chapters", "0002_two.md"), "# Chapter 2\n\nIn the end Nell learnt that Pell had hidden the lantern in the reeds.\n");
    const state = join(bookDir, "story", "state");
    await mkdir(state, { recursive: true });
    await writeFile(join(state, "manifest.json"), JSON.stringify({ schemaVersion: 2, language: "en", lastAppliedChapter: 2, projectionVersion: 1 }));
    await writeFile(join(state, "current_state.json"), JSON.stringify({ chapter: 2, facts: [] }));
    await writeFile(join(state, "chapter_summaries.json"), JSON.stringify({ rows: [] }));
    await writeFile(join(state, "hooks.json"), JSON.stringify({
      hooks: [hook("lantern", 1, 1, "Who hid the lantern in the reeds"), hook("whistle", 1, 1, "What the silver whistle means")],
    }));
  });

  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(projectDir, { recursive: true, force: true });
  });

  const inkos = (...args: string[]) => new Promise<{ stdout: string; stderr: string; code: number | null }>((done) => {
    const { port } = server.address() as AddressInfo;
    const child = spawn("node", [
      cliEntry, "--service", "custom", "--base-url", `http://127.0.0.1:${port}/v1`, "--api-format", "chat",
      "--model", "mock", "--no-stream", "--api-key-env", "PLOTLINT_TEST_KEY", "lint", ...args,
    ], { cwd: projectDir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => done({ stdout, stderr, code }));
  });

  it("reconciles open hooks with located evidence, skips unchanged ones on a re-run, and lists both statuses", async () => {
    const first = await inkos("hooks", "reconcile", "fen");
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("[1/2] lantern: asking…");
    expect(first.stdout).toContain("[1/2] lantern: resolved in ch2: \"Pell had hidden the lantern in the reeds\"");
    expect(first.stdout).toContain("[2/2] whistle: stays open");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("=== CHAPTER 2 ===");
    expect(prompts[0]).not.toContain("=== CHAPTER 1 ===");

    const overlay = JSON.parse(await readFile(join(bookDir, "story", "plotlint", "hooks.json"), "utf-8"));
    expect(overlay).toMatchObject({
      version: 1,
      hooks: [
        { id: "lantern", status: "resolved", resolvedIn: 2, evidence: "Pell had hidden the lantern in the reeds", annotator: "llm@mock" },
        { id: "whistle", status: "open", annotator: "llm@mock" },
      ],
    });

    const again = await inkos("hooks", "reconcile", "fen", "--json");
    expect(again.stderr).toContain("[1/2] lantern: unchanged, kept (resolved ch2)");
    expect(prompts).toHaveLength(2);
    expect(JSON.parse(again.stdout).hooks.map((entry: { outcome: string }) => entry.outcome)).toEqual(["kept", "kept"]);

    const list = await inkos("hooks", "fen");
    expect(list.stdout).toContain("fen: 2 hooks, 2 left open by the ledger, 1 of them resolved by the overlay");
    expect(list.stdout).toMatch(/lantern\s+ch1→ch1\s+open\s+resolved ch2 \(llm@mock\)/u);

    // The structure checks read the ledger through the overlay: only the whistle is unpaid.
    await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: "fen", status: "completed", targetChapters: 2 }));
    const lint = JSON.parse((await inkos("fen", "--layers", "structure", "--json")).stdout);
    const unpaid = lint.books[0].diagnostics.filter((d: { ruleId: string }) => d.ruleId === "structure/unpaid-setup").map((d: { summary: string }) => d.summary);
    expect(unpaid).toEqual([expect.stringMatching(/silver whistle/u)]);
  }, 60_000);
});
