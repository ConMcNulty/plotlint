import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { saveRuntimeStateSnapshot } from "@actalk/inkos-core";
import { checkSnapshot, deadEntityActs, explainSeriesFindings, seriesPrelude, withSeries } from "../index.js";
import { loadSeriesPrelude } from "../node.js";
import { fact, snapshot } from "./fixtures.js";

const bookOne = snapshot([
  fact("Pell", "status", "dead", 12),
  fact("Nell", "location", "the mill", 3, 9),
  fact("Nell", "location", "London", 10),
  fact("Nell", "holds", "brass key", 4),
], 12);
const bookTwo = snapshot([fact("Nell", "location", "Ely", 1), fact("Nell", "holds", "letter", 2)], 8);

describe("series bible", () => {
  it("carries each earlier book's end state, later books superseding earlier ones", () => {
    const prelude = seriesPrelude([{ id: "one", title: "Still Water", snapshot: bookOne }, { id: "two", title: "Low Tide", snapshot: bookTwo }]);
    const carried = prelude.facts.map((entry) => `${entry.title}: ${entry.fact.subject} ${entry.fact.predicate} ${entry.fact.object}`).sort();
    expect(carried).toEqual([
      "Low Tide: Nell holds letter",
      "Low Tide: Nell location Ely",
      "Still Water: Nell holds brass key",
      "Still Water: Pell status dead",
    ]);
  });

  it("finds a character who died in an earlier book acting in this one, and says where the death was", () => {
    const prelude = seriesPrelude([{ id: "one", title: "Still Water", snapshot: bookOne }]);
    const three = snapshot([fact("Pell", "location", "the quay", 3), fact("Nell", "location", "Ely", 1)], 4);
    const series = withSeries(three, {}, prelude);
    // Nell's London ends where this book first places her.
    expect(series.carried.find((entry) => entry.as.predicate === "location")!.as.validUntilChapter).toBe(0);
    const findings = explainSeriesFindings(checkSnapshot(series.snapshot, { rules: [deadEntityActs] }), series.carried);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.chapter).toBe(3);
    expect(findings[0]!.summary).toContain("Still Water");
    expect(findings[0]!.summary).not.toMatch(/chapter 0\b/u);
    expect(findings[0]!.evidence.join("\n")).toContain("carried from Still Water, ch12");
  });

  it("loads the books series.json names, and refuses a book that names itself", async () => {
    const root = await mkdtemp(join(tmpdir(), "plotlint-series-"));
    try {
      const dir = (id: string) => join(root, id);
      await saveRuntimeStateSnapshot(dir("one"), bookOne);
      await mkdir(join(dir("three"), "story", "plotlint"), { recursive: true });
      await writeFile(join(dir("three"), "story", "plotlint", "series.json"), JSON.stringify({ version: 1, after: ["one"] }));
      const resolve = async (id: string) => ({ bookDir: dir(id), title: id === "one" ? "Still Water" : id });
      const prelude = await loadSeriesPrelude(dir("three"), "three", resolve);
      expect(prelude!.facts.some((entry) => entry.fact.subject === "Pell")).toBe(true);
      expect(await loadSeriesPrelude(dir("one"), "one", resolve)).toBeUndefined();
      await writeFile(join(dir("three"), "story", "plotlint", "series.json"), JSON.stringify({ version: 1, after: ["three"] }));
      await expect(loadSeriesPrelude(dir("three"), "three", resolve)).rejects.toThrow("lists itself");
      await writeFile(join(dir("three"), "story", "plotlint", "series.json"), JSON.stringify({ version: 1, after: ["missing"] }));
      await expect(loadSeriesPrelude(dir("three"), "three", resolve)).rejects.toThrow("no story state");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
