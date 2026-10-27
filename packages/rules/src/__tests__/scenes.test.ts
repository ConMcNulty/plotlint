import { describe, expect, it } from "vitest";
import { diagnosticScene, sceneAt, scenesOverlapping, segmentScenes, type Scene } from "../index.js";

/** Scenes must tile the text exactly, and every recorded range must point at what it claims. */
function expectTiled(text: string, scenes: ReadonlyArray<Scene>): void {
  expect(scenes[0]?.start).toBe(0);
  expect(scenes[scenes.length - 1]?.end).toBe(text.length);
  scenes.forEach((scene, index) => {
    expect(scene.index).toBe(index);
    if (index > 0) expect(scene.start).toBe(scenes[index - 1]!.end);
    expect(scene.start).toBeLessThanOrEqual(scene.bodyStart);
    expect(scene.bodyStart).toBeLessThanOrEqual(scene.end);
    if (scene.breakMarker?.kind === "hard") {
      expect(text.slice(scene.breakMarker.start, scene.breakMarker.end).trim()).toBe(scene.breakMarker.text);
      expect(scene.breakMarker.end).toBe(scene.bodyStart);
    }
    if (scene.breakMarker?.kind === "soft") expect(text.slice(scene.breakMarker.start, scene.breakMarker.end)).toBe(scene.breakMarker.text);
  });
}

function bodies(text: string, scenes: ReadonlyArray<Scene>): string[] {
  return scenes.map((scene) => text.slice(scene.bodyStart, scene.end).trim());
}

describe("segmentScenes", () => {
  it("returns one scene for text without breaks, and for empty text", () => {
    const text = "# Chapter 3: Rain\n\nMira ran.\n\nShe stopped.";
    const scenes = segmentScenes(text, { chapter: 3 });
    expect(scenes).toEqual([{ id: "ch3.s1", index: 0, start: 0, end: text.length, bodyStart: 0, kind: "hard" }]);
    expect(segmentScenes("", { chapter: 1 })).toEqual([{ id: "ch1.s1", index: 0, start: 0, end: 0, bodyStart: 0, kind: "hard" }]);
  });

  it.each([
    "***", "* * *", "---", "- - -", "___", "#", "~~~", "§", "§ § §", "◇◇◇", "◆", "＊＊＊", "※", "※※※", "………………", "——————", "  ***  ",
  ])("splits at the marker line %j", (marker) => {
    const text = `First scene.\n\n${marker}\n\nSecond scene.\n`;
    const scenes = segmentScenes(text, { chapter: 12 });
    expectTiled(text, scenes);
    expect(scenes.map((scene) => scene.id)).toEqual(["ch12.s1", "ch12.s2"]);
    expect(bodies(text, scenes)).toEqual(["First scene.", "Second scene."]);
    expect(scenes[1]).toMatchObject({ start: text.indexOf(marker), kind: "hard", breakMarker: { kind: "hard", text: marker.trim() } });
    expect(scenes[1]!.heading).toBeUndefined();
  });

  it.each(["……", "——", "**", "--", "#hashtag", "| --- | --- |", "---|---", "Text *** text"])("does not treat %j as a break", (line) => {
    const text = `First.\n${line}\nSecond.`;
    expect(segmentScenes(text, { chapter: 1 })).toHaveLength(1);
  });

  it("skips a front-matter fence at file start but still splits at later rules", () => {
    const text = "---\ntitle: Rain\n---\n\nOne.\n\n---\n\nTwo.";
    const scenes = segmentScenes(text, { chapter: 1 });
    expectTiled(text, scenes);
    expect(bodies(text, scenes)).toEqual(["---\ntitle: Rain\n---\n\nOne.", "Two."]);
  });

  it("splits at headings below the chapter title but not at the title itself", () => {
    const text = "# 第12章 雨夜\n\n## 码头\n\n他来了。\n\n## 城楼\n\n她走了。";
    const scenes = segmentScenes(text, { chapter: 12 });
    expectTiled(text, scenes);
    expect(scenes.map((scene) => scene.heading)).toEqual(["码头", "城楼"]);
    expect(bodies(text, scenes)).toEqual(["他来了。", "她走了。"]);
    // The title stays in scene 1, ahead of the folded-in first heading.
    expect(scenes[0]).toMatchObject({ start: 0, breakMarker: { start: text.indexOf("## 码头"), text: "## 码头" } });
  });

  it("treats a leading non-title heading as scene 1's heading", () => {
    const text = "## The docks\n\nHe came.\n\n### The tower ###\n\nShe left.";
    const scenes = segmentScenes(text, { chapter: 2 });
    expectTiled(text, scenes);
    expect(scenes.map((scene) => scene.heading)).toEqual(["The docks", "The tower"]);
  });

  it("folds leading, consecutive and trailing breaks so no scene is empty", () => {
    const text = "***\n\nOne.\n\n***\n\n* * *\n\n## Two\n\nTwo.\n\n***\n\n※\n";
    const scenes = segmentScenes(text, { chapter: 5 });
    expectTiled(text, scenes);
    expect(scenes.map((scene) => scene.id)).toEqual(["ch5.s1", "ch5.s2"]);
    expect(bodies(text, scenes)).toEqual(["One.", "Two.\n\n***\n\n※"]);
    expect(scenes[0]!.breakMarker).toMatchObject({ start: 0, text: "***" });
    // The scene opens at the first break of the run; its marker is the last one, next to the prose.
    expect(scenes[1]).toMatchObject({ start: text.indexOf("***\n\n* * *"), heading: "Two", breakMarker: { text: "## Two" } });
  });

  it("handles CRLF line endings with exact offsets", () => {
    const text = "# Chapter 1: Rain\r\n\r\nOne.\r\n* * *\r\nTwo.\r\n";
    const scenes = segmentScenes(text, { chapter: 1 });
    expectTiled(text, scenes);
    expect(text.slice(scenes[1]!.breakMarker!.start, scenes[1]!.breakMarker!.end)).toBe("* * *\r\n");
    expect(text.slice(scenes[1]!.bodyStart, scenes[1]!.end)).toBe("Two.\r\n");
    expect(text.slice(scenes[0]!.start, scenes[0]!.end)).toBe("# Chapter 1: Rain\r\n\r\nOne.\r\n");
  });

  it("segments CJK text with full-width markers and indentation", () => {
    const text = "第三章　风起\n　　林墨推开门。\n　　＊＊＊\n　　雨停了。\n◇◇◇\n　　天亮了。";
    const scenes = segmentScenes(text, { chapter: 3 });
    expectTiled(text, scenes);
    expect(bodies(text, scenes)).toEqual(["第三章　风起\n　　林墨推开门。", "雨停了。", "天亮了。"]);
    expect(text.slice(scenes[1]!.start, scenes[1]!.bodyStart)).toBe("　　＊＊＊\n");
  });

  it("proposes soft breaks only when asked", () => {
    const text = "Mira slept.\n\nThree days later, the ship docked.\n\nThe next morning she woke.\nOnly then did she\nThe next morning wrap.";
    expect(segmentScenes(text, { chapter: 4 })).toHaveLength(1);
    const scenes = segmentScenes(text, { chapter: 4, softBreaks: true });
    expectTiled(text, scenes);
    expect(scenes.map((scene) => scene.kind)).toEqual(["hard", "soft", "soft"]);
    expect(scenes.map((scene) => scene.breakMarker?.text)).toEqual([undefined, "Three days later", "The next morning"]);
    expect(scenes[1]!.bodyStart).toBe(scenes[1]!.start);
  });

  it("proposes Chinese soft breaks at single-newline paragraph starts", () => {
    const text = "他睡下了。\n　　三天后，船靠岸了。\n　　那天夜里，她醒了。\n　　次日他走了，三天后又回来。";
    const scenes = segmentScenes(text, { chapter: 9, softBreaks: true });
    expectTiled(text, scenes);
    expect(scenes.map((scene) => scene.breakMarker?.text)).toEqual([undefined, "三天后", "那天夜里", "次日"]);
  });

  it("does not open a soft scene before any prose", () => {
    const text = "# Chapter 2: Later\n\nThe next morning she woke.";
    expect(segmentScenes(text, { chapter: 2, softBreaks: true })).toHaveLength(1);
  });
});

describe("scene lookups", () => {
  const text = "One.\n***\nTwo.\n***\nThree.";
  const scenes = segmentScenes(text, { chapter: 7 });

  it("finds the scene at an offset", () => {
    expect(sceneAt(scenes, 0)?.id).toBe("ch7.s1");
    expect(sceneAt(scenes, text.indexOf("Two"))?.id).toBe("ch7.s2");
    expect(sceneAt(scenes, scenes[1]!.start)?.id).toBe("ch7.s2");
    expect(sceneAt(scenes, scenes[1]!.start - 1)?.id).toBe("ch7.s1");
    expect(sceneAt(scenes, text.length)?.id).toBe("ch7.s3");
    expect(sceneAt(scenes, text.length + 1)).toBeUndefined();
    expect(sceneAt(scenes, -1)).toBeUndefined();
  });

  it("lists scenes overlapping a range", () => {
    expect(scenesOverlapping(scenes, 0, text.length).map((scene) => scene.id)).toEqual(["ch7.s1", "ch7.s2", "ch7.s3"]);
    expect(scenesOverlapping(scenes, 1, scenes[1]!.start).map((scene) => scene.id)).toEqual(["ch7.s1"]);
    expect(scenesOverlapping(scenes, 1, scenes[1]!.start + 1).map((scene) => scene.id)).toEqual(["ch7.s1", "ch7.s2"]);
    expect(scenesOverlapping(scenes, text.indexOf("Three"), text.indexOf("Three")).map((scene) => scene.id)).toEqual(["ch7.s3"]);
  });

  it("maps a diagnostic to the scene where its range starts", () => {
    const start = text.indexOf("Two");
    expect(diagnosticScene({ range: { sourceId: "chapter:7", start, end: start + 3 } }, scenes)).toBe("ch7.s2");
    expect(diagnosticScene({}, scenes)).toBeUndefined();
  });
});
