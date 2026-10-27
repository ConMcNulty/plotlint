import { describe, expect, it } from "vitest";
import { checkText } from "@plotlint/rules";
import { generalPack } from "../node.js";

describe("general pack", () => {
  const rules = generalPack();

  it("loads every rule with a rationale", () => {
    expect(rules.map((r) => r.id).sort()).toEqual([
      "style/general.AITells", "style/general.AdverbClusters", "style/general.Cliches",
      "style/general.FilterWords", "style/general.Intensifiers", "style/general.Redundancies",
    ]);
    for (const rule of rules) expect(rule.rationale.length).toBeGreaterThan(40);
  });

  it("flags a sample paragraph, sparing dialogue and common -ly words", async () => {
    const text = [
      "Mira saw the door swing open. All of a sudden the room felt very cold, and she shrugged her shoulders.",
      "She slowly, carefully, silently delved into the intricate tapestry of the family's lonely history.",
      "\"I just saw a ghost,\" Tomas said. \"It was really, really pale.\"",
    ].join("\n\n");
    const diagnostics = await checkText({ sourceId: "chapter:2", chapter: 2, text }, rules);
    const found = diagnostics.map((d) => [d.ruleId.replace("style/general.", ""), text.slice(d.range!.start, d.range!.end), d.severity]);
    expect(found).toEqual([
      ["FilterWords", "saw", "note"],
      ["Cliches", "All of a sudden", "warning"],
      ["FilterWords", "felt", "note"],
      ["Intensifiers", "very", "note"],
      ["Redundancies", "shrugged her shoulders", "note"],
      ["AdverbClusters", "slowly, carefully, silently", "warning"],
      ["AITells", "delved", "note"],
      ["AITells", "intricate", "note"],
      ["AITells", "tapestry", "note"],
    ]);
    expect(diagnostics.find((d) => d.ruleId.endsWith("Redundancies"))!.fixes).toEqual([{ title: "Replace with \"shrugged\"", replacement: "shrugged" }]);
  });

  it("finds nothing in Chinese text", async () => {
    const text = "她看见门开了。突然，房间里变得非常冷，她耸了耸肩。“我刚才真的看见了鬼，”托马斯说。他慢慢地、小心地、默默地走进了错综复杂的历史。";
    expect(await checkText({ sourceId: "chapter:3", text }, rules)).toEqual([]);
  });
});
