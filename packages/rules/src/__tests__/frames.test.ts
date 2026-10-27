import { describe, expect, it } from "vitest";
import type { CurrentStateFact } from "@actalk/inkos-core";
import { checkSnapshot, frameMarkers, FramesFileSchema } from "../index.js";
import { fact, snapshot } from "./fixtures.js";

const frames = (...entries: unknown[]) => FramesFileSchema.parse({ version: 1, frames: entries });
const cited = (f: CurrentStateFact, quote: string): CurrentStateFact => ({ ...f, evidence: { quote } });

describe("frames", () => {
  const harrow = [
    fact("Harrow", "status", "dead", 2),
    fact("Harrow", "location", "the mill", 5),
  ];

  it("skips facts from a flashback chapter", () => {
    expect(checkSnapshot(snapshot(harrow, 5))).toHaveLength(1);
    expect(checkSnapshot(snapshot(harrow, 5), { book: { frames: frames({ chapter: 5, frame: "flashback" }) } })).toEqual([]);
  });

  it("downgrades a finding resting on an unreliable narrator to a note", () => {
    const [finding] = checkSnapshot(snapshot(harrow, 5), { book: { frames: frames({ chapter: 5, frame: "unreliable", pov: "Tomas" }) } });
    expect(finding).toMatchObject({ severity: "note", ruleId: "continuity/dead-entity-acts" });
    expect(finding!.evidence.at(-1)).toBe("frame: unreliable narrator (Tomas) in ch5, so this may be deliberate");
  });

  const chapter5 = [
    "# Chapter 5: The Mill",
    "",
    "Mira walked to the harbour.",
    "",
    "* * *",
    "",
    "<!-- plotlint frame: flashback -->",
    "Twenty years earlier, Harrow stood in the mill.",
    "",
  ].join("\n");
  const chapters = new Map([[5, chapter5]]);
  const scened = [
    fact("Harrow", "status", "dead", 2),
    cited(fact("Harrow", "location", "the mill", 5), "Harrow stood in the mill"),
  ];

  it("reads frame markers from chapter text, per scene", () => {
    expect(frameMarkers(chapter5, 5)).toEqual([{ chapter: 5, scene: 2, frame: "flashback" }]);
    expect(checkSnapshot(snapshot(scened, 5), { chapters })).toEqual([]);
  });

  it("applies a scene entry from frames.json only to facts cited in that scene", () => {
    const plain = new Map([[5, chapter5.replace("<!-- plotlint frame: flashback -->\n", "")]]);
    const scene2 = { book: { frames: frames({ chapter: 5, scene: 2, frame: "flashback" }) }, chapters: plain };
    expect(checkSnapshot(snapshot(scened, 5), scene2)).toEqual([]);
    const scene1 = { book: { frames: frames({ chapter: 5, scene: 1, frame: "flashback" }) }, chapters: plain };
    expect(checkSnapshot(snapshot(scened, 5), scene1)).toHaveLength(1);
  });

  it("lets a marker set a scene back to the main timeline", () => {
    const main = new Map([[5, chapter5.replace("frame: flashback", "frame: main")]]);
    expect(checkSnapshot(snapshot(scened, 5), { chapters: main, book: { frames: frames({ chapter: 5, scene: 2, frame: "flashback" }) } })).toHaveLength(1);
  });
});
