import { describe, expect, it } from "vitest";
import type { ChapterSummaryRow, CurrentStateFact, HookRecord, RuntimeStateSnapshot } from "@actalk/inkos-core";
import {
  bothLeadsPov, centralRelationship, checkSnapshot, editDistance, fairPlay, hopefulEnding, inventedTermSpelling, mysterySolution, nearSpelling,
  relationshipTone, romanceLeads, RuleConfigFileSchema, type BookRuleData, type Rule,
} from "../index.js";
import { loadCorpusBook } from "../eval/index.js";
import { fact, kinded } from "./fixtures.js";

const row = (chapter: number, characters: string): ChapterSummaryRow => ({
  chapter, title: `Chapter ${chapter}`, characters, events: "", stateChanges: "", hookActivity: "", mood: "", chapterType: "",
});

function book(last: number, parts: { facts?: CurrentStateFact[]; hooks?: HookRecord[]; rows?: ChapterSummaryRow[] } = {}): RuntimeStateSnapshot {
  return {
    manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: last, projectionVersion: 1 },
    currentState: { chapter: last, facts: parts.facts ?? [] },
    hooks: { hooks: parts.hooks ?? [] },
    chapterSummaries: { rows: parts.rows ?? [] },
  };
}

const finished: BookRuleData = { plan: { status: "completed" } };
const run = (rule: Rule, snapshot: RuntimeStateSnapshot, data: BookRuleData = {}, chapters?: Map<number, string>) =>
  checkSnapshot(snapshot, { rules: [rule], book: data, ...(chapters ? { chapters } : {}) });
const withOptions = (data: BookRuleData, id: string, options: Record<string, unknown>): BookRuleData =>
  ({ ...data, config: RuleConfigFileSchema.parse({ version: 1, rules: { [id]: { options } } }) });
const texts = (...bodies: string[]) => new Map(bodies.map((body, i) => [i + 1, `# Chapter ${i + 1}\n\n${body}\n`] as const));

describe("structure/fair-play", () => {
  const cast = [row(1, "Ines Ward, Victor Ash"), row(2, "Ines Ward"), row(3, "Ines Ward"), row(4, "Ines Ward"), row(5, "Ines Ward, Victor Ash")];
  const reveal = fact("Victor Ash", "is the killer", "of Lord Pym", 6);
  const clueFacts = [
    fact("Victor Ash", "holds", "silver letter-opener", 2),
    kinded("status", "Lord Pym", "status", "dead", 1),
    fact("silver letter-opener", "used to kill", "Lord Pym", 6),
  ];

  it("finds the solution: reveal facts in the chapter a mystery hook resolves", () => {
    const hook: HookRecord = { hookId: "who-killed-pym", startChapter: 1, type: "mystery", status: "resolved", lastAdvancedChapter: 6, expectedPayoff: "who killed Lord Pym", notes: "" };
    const solution = mysterySolution(book(6, { facts: [...clueFacts, reveal], hooks: [hook] }));
    expect(solution).toMatchObject({ chapter: 6, culprits: ["Victor Ash"], hook: { hookId: "who-killed-pym" } });
  });

  it("is quiet for a culprit introduced early and a solution clued before the reveal", () => {
    expect(run(fairPlay, book(6, { facts: [...clueFacts, reveal], rows: cast }))).toEqual([]);
  });

  it("is quiet when there is no reveal, or the 'culprit' is not yet anyone", () => {
    expect(run(fairPlay, book(6, { facts: clueFacts, rows: cast }))).toEqual([]);
    expect(run(fairPlay, book(6, { facts: [fact("Lord Pym", "killed by", "unknown assailant", 1)], rows: cast }))).toEqual([]);
  });

  it("flags a culprit who first appears late, and a solution resting only on the reveal chapter", () => {
    const late = [fact("Lord Pym", "status", "dead", 1), fact("Dr Hale", "murdered", "Lord Pym", 6), fact("Dr Hale", "holds", "vial of arsenic", 6)];
    const found = run(fairPlay, book(6, { facts: late, rows: cast.slice(0, 5) }));
    expect(found.map((d) => d.summary)).toEqual([
      "The culprit, Dr Hale, first appears in the reveal chapter (ch6); fair play wants the culprit on the page by ch2.",
      "The solution in ch6 rests on information first given in the reveal chapter: nothing before it links Dr Hale to Lord Pym, vial of arsenic.",
    ]);
    expect(found.every((d) => d.severity === "warning" && d.confidence === "extracted" && d.ruleId === "structure/fair-play")).toBe(true);
  });

  it("reads culpritBy as a fraction of the book, or as chapters before the reveal", () => {
    const facts = [fact("Victor Ash", "location", "the mill", 4), fact("Victor Ash", "holds", "silver letter-opener", 4), reveal, clueFacts[2]!];
    const snapshot = book(6, { facts, rows: cast.slice(1, 4) });
    expect(run(fairPlay, snapshot).map((d) => d.summary)).toEqual(["The culprit, Victor Ash, first appears in ch4; fair play wants the culprit on the page by ch2."]);
    expect(run(fairPlay, snapshot, withOptions({}, "structure/fair-play", { culpritBy: 2 }))).toEqual([]);
    expect(run(fairPlay, snapshot, withOptions({}, "structure/fair-play", { culpritBy: 0.75 }))).toEqual([]);
  });

  it("counts a paragraph naming the culprit with what the reveal rests on as a clue", () => {
    const facts = [fact("Dr Hale", "murdered", "Lord Pym", 3), fact("Dr Hale", "holds", "arsenic", 3)];
    const chapters = texts("Dr Hale arrived for dinner. Lord Pym was in a mood.", "Ines watched Hale pocket the little tin of arsenic from the garden shed.", "It was Hale.");
    expect(run(fairPlay, book(3, { facts }), {}, chapters)).toEqual([]);
    const unclued = texts("Dr Hale arrived for dinner. Lord Pym was in a mood.", "The garden was quiet.", "It was Hale, with arsenic.");
    expect(run(fairPlay, book(3, { facts }), {}, unclued).map((d) => d.summary)).toEqual([
      "The solution in ch3 rests on information first given in the reveal chapter: nothing before it links Dr Hale to Lord Pym, arsenic.",
    ]);
  });
});

describe("style/invented-term-spelling", () => {
  const sedai = Array.from({ length: 6 }, (_, i) => `The council of the Aes Sedai met at dusk, day ${i}.`).join("\n\n");

  it("measures Damerau distance and near spellings", () => {
    expect(editDistance("sedai", "sedia")).toBe(1);
    expect(editDistance("mistborn", "mistbron")).toBe(1);
    expect(editDistance("abcdef", "uvwxyz")).toBe(3);
    expect(nearSpelling("Mist-born", "Mistborn")).toBe(true);
    expect(nearSpelling("Sedais", "Sedai")).toBe(false);
    expect(nearSpelling("Mara", "Maya")).toBe(false);
  });

  it("flags a rare variant of a term at each use, with a quick fix", () => {
    const chapters = texts(sedai, "She bowed to the Aes Sedia and left.");
    const [finding, ...rest] = run(inventedTermSpelling, book(2), {}, chapters);
    expect(rest).toEqual([]);
    const text = chapters.get(2)!;
    expect(finding).toMatchObject({
      ruleId: "style/invented-term-spelling", layer: "style", severity: "warning", confidence: "deterministic", chapter: 2,
      summary: "\"Sedia\" looks like a variant of \"Sedai\", which the book uses 6 times.",
      range: { sourceId: "chapter:2", start: text.indexOf("Sedia"), end: text.indexOf("Sedia") + 5 },
      fixes: [{ title: "Change to \"Sedai\"", replacement: "Sedai" }],
    });
  });

  it("flags hyphen and apostrophe variants", () => {
    const chapters = texts(Array.from({ length: 5 }, () => "Only a Mistborn could do it.").join(" "), "Even a Mist-born tires.");
    expect(run(inventedTermSpelling, book(2), {}, chapters).map((d) => d.summary)).toEqual(["\"Mist-born\" looks like a variant of \"Mistborn\", which the book uses 5 times."]);
  });

  it("leaves plurals, possessives, distinct names, common words and sentence openers alone", () => {
    const chapters = texts(
      sedai,
      "Two Sedais came; the Aes Sedai's tower stood. Mara saw Maya. Mara and Maya laughed, Mara and Maya.",
      "Mara and Maya again; Mara.",
      "The Order met. The Order voted. The Order rose. The Order fell. In order to win, they ran. Order was kept by the Orders.",
      "Sedia was a word she said once. Haven met the Raven, the Raven, the Raven and the Raven.",
    );
    const snapshot = book(5, { facts: [fact("Mara", "location", "hall", 2), fact("Maya", "location", "hall", 2)] });
    expect(run(inventedTermSpelling, snapshot, {}, chapters)).toEqual([]);
  });

  it("is quiet on the clean corpus book and catches a planted misspelling in it", async () => {
    const clean = await loadCorpusBook("wenlow");
    const snapshot = book(5, { facts: [...clean.facts] });
    expect(run(inventedTermSpelling, snapshot, clean.book, new Map(clean.chapters))).toEqual([]);
    const planted = new Map(clean.chapters);
    planted.set(3, planted.get(3)!.replace("ten years, Elspeth.", "ten years, Elpseth."));
    const found = run(inventedTermSpelling, snapshot, clean.book, planted);
    expect(found.map((d) => [d.chapter, d.summary, d.fixes?.[0]?.replacement])).toEqual([[3, expect.stringContaining("\"Elpseth\" looks like a variant of \"Elspeth\""), "Elspeth"]]);
  });
});

describe("romance rules", () => {
  const anna = "Anna Reyes";
  const ben = "Ben Okafor";
  const couple = (predicate: string, object: string, chapter: number, until: number | null = null) => kinded("relationship", anna, predicate, object, chapter, until);
  const rows = (n: number, both: number[]) => Array.from({ length: n }, (_, i) => row(i + 1, both.includes(i + 1) ? `${anna}, ${ben}` : anna));

  it("finds the leads by their relationship facts, or from options", () => {
    const facts = [couple("attitude toward", `distrusts ${ben}`, 1), couple("relationship", `in love with ${ben}`, 3), kinded("relationship", anna, "sister", "Carla Reyes", 1)];
    expect(romanceLeads(book(3, { facts }))).toEqual([anna, ben]);
    expect(romanceLeads(book(3, { facts: facts.slice(2) }))).toBeNull();
    expect(romanceLeads(book(3), { leads: ["Kit", "Sam"] })).toEqual(["Kit", "Sam"]);
  });

  it("reads a relationship's tone, negation first", () => {
    expect(relationshipTone(couple("relationship", `no longer loves ${ben}`, 1))).toBe("ended");
    expect(relationshipTone(couple("relationship", `broke up with ${ben}`, 1))).toBe("ended");
    expect(relationshipTone(couple("relationship", `engaged to ${ben}`, 1))).toBe("together");
    expect(relationshipTone(couple("relationship", `head over heels for ${ben}`, 1))).toBe("unclear");
  });

  describe("structure/hopeful-ending", () => {
    const start = [couple("relationship", `rivals with ${ben}`, 1), couple("relationship", `in love with ${ben}`, 5)];

    it("warns when a finished book's last word on the couple is a break-up", () => {
      const facts = [...start, kinded("relationship", ben, "relationship", `broke up with ${anna}`, 9)];
      const [finding, ...rest] = run(hopefulEnding, book(10, { facts }), finished);
      expect(rest).toEqual([]);
      expect(finding).toMatchObject({ ruleId: "structure/hopeful-ending", severity: "warning", confidence: "extracted", chapter: 9 });
      expect(finding!.summary).toBe(`The last word on ${anna} and ${ben} is "broke up with ${anna}" (ch9), with nothing hopeful after it; romance readers expect a happy or hopeful ending.`);
    });

    it("warns when a lead dies at the end", () => {
      const facts = [...start, kinded("status", ben, "status", "dead", 10)];
      expect(run(hopefulEnding, book(10, { facts }), finished)[0]!.summary).toMatch(/^The book ends with Ben Okafor dead \(ch10\)/u);
    });

    it("is quiet for a reconciliation, an ending undone, an unfinished book, or no couple", () => {
      const broke = couple("relationship", `separated from ${ben}`, 7);
      expect(run(hopefulEnding, book(10, { facts: [...start, broke, couple("relationship", `reunited with ${ben}`, 9)] }), finished)).toEqual([]);
      expect(run(hopefulEnding, book(10, { facts: [...start, broke, couple("relationship", `married to ${ben}`, 7)] }), finished)).toEqual([]);
      expect(run(hopefulEnding, book(10, { facts: [...start, couple("relationship", `separated from ${ben}`, 7, 8)] }), finished)).toEqual([]);
      expect(run(hopefulEnding, book(10, { facts: [...start, broke] }), { plan: { status: "active", targetChapters: 30 } })).toEqual([]);
      expect(run(hopefulEnding, book(10, { facts: [broke] }), finished)).toEqual([]);
    });

    it("takes the leads from options", () => {
      const facts = [kinded("relationship", "Kit", "relationship", "left Sam", 4)];
      expect(run(hopefulEnding, book(5, { facts }), withOptions(finished, "structure/hopeful-ending", { leads: ["Kit", "Sam"] }))).toHaveLength(1);
    });
  });

  describe("structure/central-relationship", () => {
    const facts = [couple("relationship", `rivals with ${ben}`, 1), couple("relationship", `in love with ${ben}`, 8)];

    it("notes a book where the leads share too few chapters", () => {
      const [finding, ...rest] = run(centralRelationship, book(10, { facts, rows: rows(10, [1, 8]) }));
      expect(rest).toEqual([]);
      expect(finding).toMatchObject({ severity: "note", summary: `${anna} and ${ben} share only 20% of the chapters (2 of 10); in a romance their relationship is the main plot (floor 40%).` });
    });

    it("is quiet when they share enough of the book, counting chapter text, or with a lower floor", () => {
      expect(run(centralRelationship, book(10, { facts, rows: rows(10, [1, 2, 3, 6, 8]) }))).toEqual([]);
      const chapters = texts(...Array.from({ length: 10 }, (_, i) => (i % 2 ? "Anna waited." : "Anna and Ben argued.")));
      expect(run(centralRelationship, book(10, { facts, rows: rows(10, []) }), {}, chapters)).toEqual([]);
      expect(run(centralRelationship, book(10, { facts, rows: rows(10, [1, 8]) }), withOptions({}, "structure/central-relationship", { minShare: 0.2 }))).toEqual([]);
    });
  });

  describe("structure/both-leads-pov", () => {
    const facts = [couple("relationship", `rivals with ${ben}`, 1), couple("relationship", `in love with ${ben}`, 3)];
    const withScenes = (povs: Array<string | null>) => ({ scenes: { version: 1, scenes: povs.map((pov, i) => ({ chapter: i + 1, pov })) } }) as unknown as BookRuleData;

    it("is silent without scene annotations", () => {
      expect(run(bothLeadsPov, book(3, { facts }))).toEqual([]);
      expect(run(bothLeadsPov, book(3, { facts }), withScenes([null, null]))).toEqual([]);
    });

    it("notes a lead who never has the point of view", () => {
      const [finding, ...rest] = run(bothLeadsPov, book(3, { facts }), withScenes(["Anna", "Anna Reyes", null]));
      expect(rest).toEqual([]);
      expect(finding).toMatchObject({ ruleId: "structure/both-leads-pov", severity: "note", summary: "Ben Okafor never has the point of view: none of the 2 annotated scenes is theirs." });
      expect(run(bothLeadsPov, book(3, { facts }), withScenes(["Anna", "Ben", "Anna"]))).toEqual([]);
    });
  });
});
