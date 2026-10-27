import { describe, expect, it } from "vitest";
import { checkSnapshot, knowledgeLeak } from "../index.js";
import { fact, kinded, snapshot } from "./fixtures.js";

type Facts = Parameters<typeof snapshot>[0];
const check = (facts: Facts, chapters?: Map<number, string>) =>
  checkSnapshot(snapshot(facts, 12), { rules: [knowledgeLeak], ...(chapters ? { chapters } : {}) });

const identity = fact("Pell", "true identity", "Harrow's son", 2);
const learns = fact("Mira", "learned", "Pell is Harrow's son", 6);

describe("continuity/knowledge-leak (state)", () => {
  it("warns when a character's goal names a secret before they learn it, citing all three facts", () => {
    const diagnostics = check([identity, learns, kinded("goal", "Mira", "goal", "tell Pell he is Harrow's son", 4)]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "continuity/knowledge-leak",
      severity: "warning",
      confidence: "extracted",
      chapter: 4,
      summary: "Mira acts on Pell's secret (Harrow's son) in chapter 4, before learning it in chapter 6.",
    });
    expect(diagnostics[0]!.evidence[0]).toMatch(/^acts on it: Mira · goal · tell Pell/u);
    expect(diagnostics[0]!.evidence[1]).toMatch(/^secret: Pell · true identity/u);
    expect(diagnostics[0]!.evidence[2]).toMatch(/^learns it: Mira · learned/u);
    expect(diagnostics[0]!.facts).toHaveLength(3);
  });

  it("reads deliberate actions and a hidden place", () => {
    const [finding] = check([
      fact("vault", "location", "hidden beneath the chapel", 1),
      fact("Mira", "heads to", "the vault beneath the chapel", 3),
      fact("Mira", "discovered", "the vault is beneath the chapel", 7),
    ]);
    expect(finding).toMatchObject({ chapter: 3, summary: expect.stringContaining("before learning it in chapter 7") });
  });

  it("links a knowledge fact that names the subject and the concealed aspect", () => {
    expect(check([
      identity,
      fact("Mira", "learned", "Pell's true identity", 6),
      fact("Mira", "blackmails", "Pell over being Harrow's son", 3),
    ])).toHaveLength(1);
  });

  it("says nothing without a later knowledge fact for the character", () => {
    expect(check([identity, kinded("goal", "Mira", "goal", "tell Pell he is Harrow's son", 4)])).toEqual([]);
  });

  it("ignores acts in or after the chapter the character learns it", () => {
    expect(check([identity, learns, kinded("goal", "Mira", "goal", "tell Pell he is Harrow's son", 6)])).toEqual([]);
    expect(check([identity, learns, kinded("goal", "Mira", "goal", "tell Pell he is Harrow's son", 8)])).toEqual([]);
  });

  it("uses the character's first knowledge fact", () => {
    expect(check([
      identity,
      fact("Mira", "knows", "Pell is Harrow's son", 3),
      learns,
      kinded("goal", "Mira", "goal", "tell Pell he is Harrow's son", 4),
    ])).toEqual([]);
  });

  it("ignores inquiry, suspicion and doubt", () => {
    expect(check([identity, learns, kinded("goal", "Mira", "goal", "find out whether Pell is Harrow's son", 4)])).toEqual([]);
    expect(check([identity, learns, kinded("goal", "Mira", "goal", "investigate if Pell is Harrow's son", 4)])).toEqual([]);
    expect(check([identity, fact("Mira", "suspects", "Pell is Harrow's son", 6), kinded("goal", "Mira", "goal", "tell Pell he is Harrow's son", 4)])).toEqual([]);
    expect(check([identity, fact("Mira", "does not know", "Pell is Harrow's son", 6), kinded("goal", "Mira", "goal", "tell Pell he is Harrow's son", 4)])).toEqual([]);
  });

  it("ignores plain location and facts that are not acts", () => {
    // Held in the hidden vault without knowing what it is.
    expect(check([
      fact("vault", "location", "hidden beneath the chapel", 1),
      fact("Mira", "location", "the vault beneath the chapel", 3),
      fact("Mira", "mood", "afraid of the vault beneath the chapel", 3),
      fact("Mira", "discovered", "the vault is beneath the chapel", 7),
    ])).toEqual([]);
  });

  it("ignores facts that are not secret", () => {
    expect(check([
      fact("Pell", "father", "Harrow", 2),
      fact("Mira", "learned", "Pell is Harrow's son", 6),
      kinded("goal", "Mira", "goal", "tell Pell he is Harrow's son", 4),
    ])).toEqual([]);
  });

  it("needs the secret's subject alongside a short value", () => {
    // "chapel" alone is too common to stand for "the vault is beneath the chapel".
    expect(check([
      fact("vault", "location", "hidden beneath the chapel", 1),
      kinded("goal", "Mira", "goal", "pray at the chapel", 3),
      fact("Mira", "discovered", "the vault is beneath the chapel", 7),
    ])).toEqual([]);
  });

  it("matches names as whole words", () => {
    expect(check([
      fact("Pell", "secret", "hidden in the well", 1),
      kinded("goal", "Mira", "goal", "dispell the curse on the well", 3),
      fact("Mira", "discovered", "Pell's secret in the well", 7),
    ])).toEqual([]);
  });

  it("reports one finding per character and secret", () => {
    expect(check([
      identity,
      fact("Pell", "secret", "is Harrow's son", 2),
      learns,
      kinded("goal", "Mira", "goal", "tell Pell he is Harrow's son", 4),
      fact("Mira", "confronts", "Pell about being Harrow's son", 5),
    ])).toHaveLength(1);
  });

  it("reads Chinese secrets", () => {
    const [finding] = check([
      fact("林远", "真实身份", "魔教少主", 2),
      fact("苏晴", "得知", "林远是魔教少主", 8),
      kinded("goal", "苏晴", "目标", "揭穿林远魔教少主的身份", 5),
    ]);
    expect(finding).toMatchObject({ chapter: 5 });
    expect(check([
      fact("林远", "真实身份", "魔教少主", 2),
      fact("苏晴", "得知", "林远是魔教少主", 8),
      kinded("goal", "苏晴", "目标", "查明林远是否魔教少主", 5),
    ])).toEqual([]);
  });
});

describe("continuity/knowledge-leak (dialogue)", () => {
  const chapter4 = [
    "# Chapter 4: The Quay",
    "",
    "Rain came off the harbour in sheets.",
    "",
    "\"You are Harrow's son, and you always were,\" Mira said, not looking at him.",
    "",
  ].join("\n");

  it("warns on a line of the character's dialogue that states the secret, with a range in the chapter text", () => {
    const chapters = new Map([[4, chapter4]]);
    const diagnostics = check([identity, learns], chapters);
    expect(diagnostics).toHaveLength(1);
    const [finding] = diagnostics;
    expect(finding).toMatchObject({
      chapter: 4,
      summary: "Mira says Pell's secret (Harrow's son) in chapter 4, before learning it in chapter 6.",
    });
    expect(finding!.evidence[0]).toBe("dialogue (ch4): \"You are Harrow's son, and you always were,\"");
    expect(finding!.facts).toHaveLength(2);
    const { sourceId, start, end } = finding!.range!;
    expect(sourceId).toBe("chapter:4");
    expect(chapter4.slice(start, end)).toBe("\"You are Harrow's son, and you always were,\"");
    expect(finding!.sourceRefs).toEqual([{ sourceId: "chapter:4", quote: "\"You are Harrow's son, and you always were,\"" }]);
  });

  it("reads tags before the quote, curly quotes, last names and script-style lines", () => {
    const named = fact("Mira Vance", "learned", "Pell is Harrow's son", 6);
    for (const line of [
      "Vance said, “You are Harrow's son.”",
      "“You are Harrow's son,” said Mira.",
      "Mira: \"You are Harrow's son.\"",
    ]) {
      expect(check([identity, named], new Map([[3, line]])), line).toHaveLength(1);
    }
  });

  it("ignores lines spoken by someone else", () => {
    for (const line of [
      "\"You are Harrow's son,\" Tomas said to Mira.",
      "Mira turned. \"Go,\" she said. \"You are Harrow's son,\" said Tomas.",
    ]) {
      expect(check([identity, learns], new Map([[3, line]])), line).toEqual([]);
    }
  });

  it("ignores questions and doubt", () => {
    for (const line of [
      "\"Are you Harrow's son?\" Mira asked.",
      "\"Maybe you are Harrow's son,\" Mira said.",
      "\"You are not Harrow's son,\" Mira said.",
    ]) {
      expect(check([identity, learns], new Map([[3, line]])), line).toEqual([]);
    }
  });

  it("only reads chapters after the secret is established and before the character learns it", () => {
    const line = "\"You are Harrow's son,\" Mira said.";
    expect(check([identity, learns], new Map([[2, line]]))).toEqual([]);
    expect(check([identity, learns], new Map([[6, line]]))).toEqual([]);
    expect(check([identity, learns], new Map([[9, line]]))).toEqual([]);
  });

  it("says nothing without a knowledge fact for the speaker", () => {
    expect(check([identity], new Map([[4, chapter4]]))).toEqual([]);
  });

  it("skips dialogue in a flashback", () => {
    const text = "<!-- plotlint frame: flashback -->\n\n\"You are Harrow's son,\" Mira said.";
    expect(check([identity, learns], new Map([[4, text]]))).toEqual([]);
  });

  it("prefers the dialogue over a state fact in the same chapter", () => {
    const [finding] = check(
      [identity, learns, kinded("goal", "Mira", "goal", "tell Pell he is Harrow's son", 4)],
      new Map([[4, chapter4]]),
    );
    expect(finding!.range).toBeDefined();
    expect(finding!.facts).toHaveLength(3);
  });

  it("reads Chinese dialogue", () => {
    const facts = [fact("林远", "真实身份", "魔教少主", 2), fact("苏晴", "得知", "林远是魔教少主", 8)];
    expect(check(facts, new Map([[5, "苏晴冷冷道：“你就是魔教少主。”"]]))).toHaveLength(1);
    expect(check(facts, new Map([[5, "“你就是魔教少主。”苏晴说。"]]))).toHaveLength(1);
    // 林远 speaking to 苏晴 is not 苏晴 speaking.
    expect(check(facts, new Map([[5, "林远对苏晴说：“我就是魔教少主。”"]]))).toEqual([]);
    expect(check(facts, new Map([[5, "苏晴问：“你难道是魔教少主？”"]]))).toEqual([]);
  });
});
