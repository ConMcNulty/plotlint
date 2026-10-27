import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Suppression } from "../index.js";
import { addSuppression, loadSuppressions, removeSuppressions, suppressionsPath } from "../node.js";

const createdAt = "2026-10-27T00:00:00.000Z";
const ruleId = "continuity/dead-entity-acts";
const rule: Suppression = { kind: "rule", ruleId, reason: "ghost story", createdAt };
const instance = (fingerprint: string, reason = "flashback"): Suppression =>
  ({ kind: "instance", ruleId, fingerprint, reason, createdAt, chapter: 3 });

describe("plotlint suppressions store", () => {
  let bookDir: string;

  beforeEach(async () => {
    bookDir = await mkdtemp(join(tmpdir(), "plotlint-suppressions-"));
  });

  afterEach(async () => {
    await rm(bookDir, { recursive: true, force: true });
  });

  it("keeps the file beside the book's story state and starts empty", async () => {
    expect(suppressionsPath(bookDir)).toBe(join(bookDir, "story", "plotlint", "suppressions.json"));
    expect(await loadSuppressions(bookDir)).toEqual({ version: 1, suppressions: [] });
  });

  it("adds, replaces and round-trips suppressions", async () => {
    expect(await addSuppression(bookDir, instance("aaaa"))).toEqual({ replaced: false });
    expect(await addSuppression(bookDir, rule)).toEqual({ replaced: false });
    expect(await addSuppression(bookDir, instance("aaaa", "dream"))).toEqual({ replaced: true });
    expect(await addSuppression(bookDir, instance("bbbb"))).toEqual({ replaced: false });
    expect((await loadSuppressions(bookDir)).suppressions).toEqual([rule, instance("aaaa", "dream"), instance("bbbb")]);
    expect(JSON.parse(await readFile(suppressionsPath(bookDir), "utf-8")).version).toBe(1);
  });

  it("removes the rule-wide suppression, one instance, or all of a rule", async () => {
    for (const suppression of [rule, instance("aaaa"), instance("bbbb")]) await addSuppression(bookDir, suppression);
    expect(await removeSuppressions(bookDir, { ruleId })).toEqual([rule]);
    expect(await removeSuppressions(bookDir, { ruleId })).toEqual([]);
    expect(await removeSuppressions(bookDir, { ruleId, fingerprint: "aaaa" })).toEqual([instance("aaaa")]);
    await addSuppression(bookDir, rule);
    expect(await removeSuppressions(bookDir, { ruleId, all: true })).toEqual([instance("bbbb"), rule]);
    expect((await loadSuppressions(bookDir)).suppressions).toEqual([]);
  });

  it("refuses a malformed file instead of silently dropping suppressions", async () => {
    await mkdir(dirname(suppressionsPath(bookDir)), { recursive: true });
    await writeFile(suppressionsPath(bookDir), JSON.stringify({ version: 1, suppressions: [{ kind: "rule", ruleId }] }));
    await expect(loadSuppressions(bookDir)).rejects.toThrow(/Invalid suppressions file/);
  });
});
