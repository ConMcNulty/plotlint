import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, createWorkManifest, saveWorkManifest } from "@actalk/inkos-core";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(testDir, "..", "..", "dist", "index.js");

const PLAIN: Record<string, string> = { "all of a sudden": "suddenly", "in the nick of time": "just in time", "crystal clear": "clear" };

describe("inkos lint loop", () => {
  let projectDir: string;
  let bookDir: string;
  let server: Server;
  let systems: string[] = [];
  const env = () => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INKOS_") && !/^https?_proxy$/iu.test(key))),
    HOME: projectDir,
    PLOTLINT_TEST_KEY: "test-key",
  });

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "inkos-cli-loop-"));
    systems = [];
    // An author that swaps each flagged cliché for a plain phrase, and readers with nothing to report.
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const messages = (JSON.parse(body) as { messages: Array<{ content: string }> }).messages;
        const system = messages[0]!.content;
        systems.push(system);
        let content: string;
        if (system.startsWith("You are the author")) {
          const prompt = messages.at(-1)!.content;
          const responses = [...prompt.matchAll(/\[(f\d+)\] [^\n]*\n(?:[^\n]*\n)*?\s+flagged text: "([^"]+)"/gu)].map(([, id, flagged]) => {
            const plain = PLAIN[flagged!.toLowerCase()];
            return plain
              ? { id, action: "fix", reason: "plainer", edits: [{ find: flagged, replace: flagged![0] === flagged![0]!.toUpperCase() ? plain[0]!.toUpperCase() + plain.slice(1) : plain }] }
              : { id, action: "defer", reason: "not part of this pass; it needs a look at the whole chapter", edits: [] };
          });
          content = JSON.stringify({ responses });
        } else {
          content = JSON.stringify({ reactions: [], prediction: "Nell will open the box." });
        }
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
    const chapter = "# Chapter 1\n\nAll of a sudden the lamp went out. Nell reached the gate in the nick of time.\n\nThe water was crystal clear and the box lay on the bottom.\n";
    await writeFile(join(bookDir, "chapters", "0001_one.md"), chapter);
    await writeFile(join(bookDir, "chapters", "0002_two.md"), chapter.replace("Chapter 1", "Chapter 2"));
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

  it("revises a chapter until clean, applies it, and runs the blind comparison", async () => {
    const run = await inkos("loop", "fen", "--chapter", "1", "--layers", "style", "--apply", "--json");
    expect(run.stderr).toContain("round 1: 3 open");
    const result = JSON.parse(run.stdout);
    expect(result).toMatchObject({ chapter: 1, applied: true, stop: { reason: "clean" }, gate: { needsHuman: false } });
    expect(result.visible.end.warnings).toBe(0);
    const text = await readFile(join(bookDir, "chapters", "0001_one.md"), "utf-8");
    expect(text).toContain("Suddenly the lamp went out. Nell reached the gate just in time.");
    expect(text).toContain("The water was clear");
    // The author, one reader in round 0 and the held-out reader at the start and the end.
    expect(systems.filter((system) => system.startsWith("You are the author"))).toHaveLength(1);
    expect(systems.some((system) => system.includes("acquiring editor"))).toBe(true);
    const runs = await readdir(join(bookDir, "story", "plotlint", "loop", "runs"));
    expect(runs).toHaveLength(1);
    const log = JSON.parse(await readFile(join(bookDir, "story", "plotlint", "loop", "runs", runs[0]!, "log.json"), "utf-8"));
    expect(log.rounds[0].decisions.map((decision: { outcome: string }) => decision.outcome)).toEqual(["applied", "applied", "applied"]);
    expect(log.predictions[0].text).toBe("Nell will open the box.");

    // The applied words are the loop author's; the rest keeps its origin (unknown: no chapter index entry).
    const provenance = JSON.parse((await inkos("provenance", "fen", "--json")).stdout);
    expect(provenance.byAuthor["agent:loop-author@mock"].words).toBeGreaterThan(0);
    expect(provenance.chapters[0]).toMatchObject({ chapter: 1, current: true });
    const spans = JSON.parse((await inkos("provenance", "fen", "--chapter", "1", "--json")).stdout).spans;
    expect(spans.find((span: { text: string }) => span.text.includes("Suddenly"))).toMatchObject({ by: "agent:loop-author@mock" });
    expect(spans.find((span: { text: string }) => span.text.includes("lamp went out"))).toMatchObject({ by: "unknown" });
    // An edit in another editor is unknown until someone owns it.
    await writeFile(join(bookDir, "chapters", "0001_one.md"), `${text}Nell laughed.\n`);
    expect((await inkos("provenance", "fen", "--json")).stdout).toContain('"current": false');
    expect((await inkos("provenance", "record", "fen", "--chapter", "1", "--by", "human:nell")).stdout).toContain("recorded ch1");
    const owned = JSON.parse((await inkos("provenance", "fen", "--chapter", "1", "--json")).stdout).spans;
    expect(owned.find((span: { text: string }) => span.text.includes("laughed"))).toMatchObject({ by: "human:nell", via: "cli" });
    const reportPath = join(projectDir, "provenance.md");
    expect((await inkos("provenance", "fen", "--report", reportPath)).code).toBe(0);
    expect(await readFile(reportPath, "utf-8")).toContain("| human:nell |");

    const compare = await inkos("loop", "compare", "fen", "--chapter", "2", "--layers", "style", "--readers", "0", "--pair", "p1", "--json");
    expect(compare.code).toBe(0);
    expect(JSON.parse(compare.stdout)).toMatchObject({ pair: "p1", loop: { stop: { reason: "clean" } }, single: { rounds: 1 } });
    expect((await readdir(join(bookDir, "story", "plotlint", "loop", "blind", "p1"))).sort()).toEqual(["A.md", "B.md"]);
    // Compare never touches the chapter.
    expect(await readFile(join(bookDir, "chapters", "0002_two.md"), "utf-8")).toContain("All of a sudden");

    expect((await inkos("loop", "prefer", "p1", "A", "fen", "--reader", "sam")).code).toBe(0);
    expect((await inkos("loop", "prefer", "p1", "B", "fen", "--reader", "glm", "--proxy")).code).toBe(0);
    const study = JSON.parse((await inkos("loop", "study", "fen", "--json")).stdout);
    expect(study).toMatchObject({ pairs: 1, preferences: { n: 1, call: "not enough data", proxy: { n: 1 } }, heldOutFellWhileVisibleRose: 0 });
    expect(study.runs).toHaveLength(2);
  }, 90_000);

  it("keeps an applied revision and says so when the chapter cannot be settled again", async () => {
    const run = await inkos("loop", "fen", "--chapter", "2", "--layers", "style", "--readers", "0", "--no-held-out-reader", "--apply", "--resettle", "--json");
    expect(run.code).toBe(1);
    const result = JSON.parse(run.stdout);
    expect(result).toMatchObject({ chapter: 2, applied: true });
    expect(result.settleFailed).toBeTruthy();
    expect(run.stderr).toContain("story state still reflects the old text");
    expect(await readFile(join(bookDir, "chapters", "0002_two.md"), "utf-8")).toContain("Suddenly the lamp went out.");
  }, 90_000);
});
