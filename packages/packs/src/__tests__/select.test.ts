import { describe, expect, it } from "vitest";
import { builtinPacks, parseProposal, proposalPrompt, proposePacks } from "../node.js";

describe("pack proposals", () => {
  const packs = builtinPacks();

  it("builds a prompt with the packs, the brief and the opening chapters", () => {
    const [system, user] = proposalPrompt({ title: "Thorn Court", genre: "other", brief: "A fae court intrigue.", chapters: ["Ch one."] }, packs);
    expect(system!.content).toContain("- romance: Romance.");
    expect(system!.content).not.toContain("- general:");
    expect(user!.content).toContain("Title: Thorn Court");
    expect(user!.content).toContain("A fae court intrigue.");
    expect(user!.content).toContain("Chapter 1 (opening):\nCh one.");
  });

  it("parses replies, dropping general and rejecting unknown packs", () => {
    expect(parseProposal("<think>hm</think>{\"packs\": [\"Romance\", \"fantasy\", \"general\"], \"reasoning\": \"Fae and a slow burn.\"}", packs))
      .toEqual({ packs: ["romance", "fantasy"], reasoning: "Fae and a slow burn." });
    expect(parseProposal("{\"packs\": [\"horror\"], \"reasoning\": \"x\"}", packs)).toMatch(/unknown packs horror/u);
    expect(parseProposal("no json", packs)).toMatch(/no JSON/u);
  });

  it("retries once with the problem", async () => {
    const replies = ["{\"packs\": \"mystery\"}", "{\"packs\": [\"mystery\"], \"reasoning\": \"A detective and a body.\"}"];
    const seen: number[] = [];
    const proposal = await proposePacks({ genre: "other" }, packs, async (messages) => {
      seen.push(messages.length);
      return replies.shift()!;
    });
    expect(proposal).toEqual({ packs: ["mystery"], reasoning: "A detective and a body." });
    expect(seen).toEqual([2, 4]);
  });
});
