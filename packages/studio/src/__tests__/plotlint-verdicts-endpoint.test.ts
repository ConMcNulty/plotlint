import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager } from "@actalk/inkos-core";
import { createStudioServer } from "../api/server.js";
import { parseVerdictBody } from "../api/plotlint-verdicts.js";

const BOOK = "harbour-book";

const verdict = (fingerprint: string, action: string, extra: Record<string, unknown> = {}) => ({
  ruleId: "style/general.Cliches",
  fingerprint,
  chapter: 3,
  action,
  quote: "at the end of the day",
  layer: "style",
  confidence: "deterministic",
  ...extra,
});

describe("plotlint verdicts endpoint", () => {
  let root: string;
  let bookDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-verdicts-"));
    bookDir = new StateManager(root).bookDir(BOOK);
    await mkdir(bookDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const post = (body: unknown) => createStudioServer({} as never, root).request("/api/v1/plotlint/verdicts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const get = (bookId: string) => createStudioServer({} as never, root).request(`/api/v1/plotlint/verdicts?bookId=${encodeURIComponent(bookId)}`);

  it("appends verdicts to the book's log and reports stats per check", async () => {
    const saved = await post({ bookId: BOOK, verdicts: [verdict("a", "not-useful"), verdict("b", "fix", { verdict: "accepted" })] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ ok: true, recorded: 2 });
    // The writer changes their mind about "a".
    await post({ bookId: BOOK, verdicts: [verdict("a", "edited")] });

    const lines = (await readFile(join(bookDir, "story", "plotlint", "verdicts.jsonl"), "utf-8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => [line.fingerprint, line.verdict, line.action])).toEqual([["a", "rejected", "not-useful"], ["b", "accepted", "fix"], ["a", "accepted", "edited"]]);
    expect(Date.parse(lines[0].at)).not.toBeNaN();

    const report = await (await get(BOOK)).json();
    expect(report).toMatchObject({ total: 3, skipped: [], lowered: [] });
    expect(report.stats).toEqual([expect.objectContaining({ ruleId: "style/general.Cliches", accepted: 2, rejected: 0, n: 2, acceptRate: 1 })]);
  });

  it("reports checks the author's verdicts lower in the book", async () => {
    await post({ bookId: BOOK, verdicts: ["a", "b", "c", "d", "e"].map((fp) => verdict(fp, "intentional")) });
    const report = await (await get(BOOK)).json();
    expect(report.lowered).toEqual([expect.objectContaining({ ruleId: "style/general.Cliches", setting: "note", n: 5 })]);
  });

  it("rejects bad verdicts, unsafe book ids and unknown books", async () => {
    expect((await post({ bookId: BOOK })).status).toBe(400);
    expect((await post({ bookId: BOOK, verdicts: [] })).status).toBe(400);
    expect((await post({ bookId: BOOK, verdicts: [verdict("a", "shrug")] })).status).toBe(400);
    expect((await post({ bookId: BOOK, verdicts: [verdict("a", "fix", { verdict: "rejected" })] })).status).toBe(400);
    expect((await post({ bookId: BOOK, verdicts: [verdict("a", "fix", { layer: "vibes" })] })).status).toBe(400);
    expect((await post({ bookId: BOOK, verdicts: [verdict("a", "fix", { path: "../x" })] })).status).toBe(400);
    expect((await post({ bookId: "../etc", verdicts: [verdict("a", "fix")] })).status).toBe(400);
    expect((await post({ bookId: "missing-book", verdicts: [verdict("a", "fix")] })).status).toBe(404);
    expect((await get("../etc")).status).toBe(400);
    expect((await get("missing-book")).status).toBe(404);
    expect((await get("")).status).toBe(400);
    expect(await readFile(join(bookDir, "story", "plotlint", "verdicts.jsonl"), "utf-8").catch(() => "none")).toBe("none");
  });

  it("caps the batch size and the quote length", () => {
    expect(parseVerdictBody({ bookId: BOOK, verdicts: Array.from({ length: 101 }, (_, i) => verdict(String(i), "fix")) })).toMatch(/at most 100/);
    const parsed = parseVerdictBody({ bookId: BOOK, verdicts: [verdict("a", "fix", { quote: "x".repeat(2000) })] }, () => "2026-10-27T00:00:00.000Z");
    expect(typeof parsed === "string" ? parsed : parsed.verdicts[0]).toMatchObject({ at: "2026-10-27T00:00:00.000Z", verdict: "accepted", quote: "x".repeat(500) });
  });
});
