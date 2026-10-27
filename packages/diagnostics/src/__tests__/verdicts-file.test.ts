import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendVerdicts, loadVerdicts, verdictsPath } from "../node.js";
import { formatVerdictLine, type Verdict } from "../verdicts.js";

const verdict = (fingerprint: string, overrides: Partial<Verdict> = {}): Verdict => ({
  ruleId: "style/general.Cliches",
  fingerprint,
  chapter: 2,
  verdict: "rejected",
  action: "not-useful",
  at: "2026-10-27T00:00:00.000Z",
  quote: "at the end of the day",
  layer: "style",
  confidence: "deterministic",
  ...overrides,
});

describe("plotlint verdicts store", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "plotlint-verdicts-"));
  });

  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
  });

  it("keeps the file beside the suppressions and starts empty", async () => {
    expect(verdictsPath(bookDir)).toBe(join(bookDir, "story", "plotlint", "verdicts.jsonl"));
    expect(await loadVerdicts(bookDir)).toEqual({ verdicts: [], skipped: [] });
  });

  it("appends one line per verdict and reads them back in order", async () => {
    await appendVerdicts(bookDir, [verdict("a")]);
    await appendVerdicts(bookDir, [verdict("b"), verdict("a", { verdict: "accepted", action: "edited" })]);
    await appendVerdicts(bookDir, []);
    const raw = await readFile(verdictsPath(bookDir), "utf-8");
    expect(raw.split("\n")).toHaveLength(4);
    expect((await loadVerdicts(bookDir)).verdicts.map((v) => [v.fingerprint, v.action])).toEqual([["a", "not-useful"], ["b", "not-useful"], ["a", "edited"]]);
  });

  it("refuses to append an invalid verdict and leaves the file alone", async () => {
    await expect(appendVerdicts(bookDir, [verdict("a", { verdict: "accepted" })])).rejects.toThrow();
    expect(await loadVerdicts(bookDir)).toEqual({ verdicts: [], skipped: [] });
  });

  it("skips bad lines, reads CRLF files and closes off a torn last line before appending", async () => {
    const path = verdictsPath(bookDir);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${formatVerdictLine(verdict("a")).trimEnd()}\r\ngarbage\r\n{"ruleId":"style/x","finge`);
    await appendVerdicts(bookDir, [verdict("b")]);
    const loaded = await loadVerdicts(bookDir);
    expect(loaded.verdicts.map((v) => v.fingerprint)).toEqual(["a", "b"]);
    expect(loaded.skipped).toEqual([2, 3]);

    await appendFile(path, "\n\n");
    expect((await loadVerdicts(bookDir)).verdicts).toHaveLength(2);
  });
});
