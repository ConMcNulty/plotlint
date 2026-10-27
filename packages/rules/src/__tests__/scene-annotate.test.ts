import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  annotateChapter, annotationPrompt, detectLanguage, locateSceneQuote, mergeSceneAnnotations, parseAnnotationReply,
  SceneAnnotationSchema, SceneAnnotationsFileSchema, sceneHash, segmentScenes, staleSceneAnnotations,
  type CompileMessage, type SceneAnnotation,
} from "../index.js";
import { loadBookRuleData } from "../node.js";

const CHAPTER = `# Chapter 3: Midnight

Mira wanted the ledger before the customs men came back. She crossed the yard with the brass key in her fist.

Pell Ostrander stood in the doorway and would not move. "Nobody goes in tonight," he said.

She lied about the harbour master's order, and he stepped aside.

* * *

Tomas waited at the lantern house. The tide came in and covered the lower steps, and he did not move.
`;

const reply = (scenes: unknown[]) => JSON.stringify({ scenes });

const goodScene1 = {
  id: "ch3.s1",
  pov: "Mira",
  goal: "get the ledger",
  opposition: "Pell blocks the door",
  outcome: "success",
  valueStart: { axis: "Safety", value: -1 },
  valueEnd: { axis: "safety", value: 1 },
  turningPoint: { description: "Mira lies her way past Pell", causedBy: "protagonist", by: "Mira", evidence: "She lied about the harbour master's order, and he stepped aside." },
  stakes: 6,
  povBreaks: [],
  evidence: {
    goal: "Mira wanted the ledger before the customs men came back.",
    opposition: "\"Nobody goes in tonight,\" he said.",
    outcome: "he stepped aside",
  },
};
const goodScene2 = {
  id: "ch3.s2",
  pov: "Tomas",
  goal: null,
  opposition: "none",
  outcome: "none",
  valueStart: { axis: "hope", value: 0 },
  valueEnd: { axis: "hope", value: 0 },
  turningPoint: null,
  stakes: "2",
  povBreaks: [{ quote: "Mira was thinking of her mother the whole time.", note: "Tomas cannot know Mira's thoughts" }],
  evidence: { outcome: "The tide came in and covered the lower steps" },
};

/** A fake model that replays canned replies and records what it was sent. */
function fake(...replies: string[]) {
  const calls: CompileMessage[][] = [];
  const complete = async (messages: ReadonlyArray<CompileMessage>) => {
    calls.push([...messages]);
    const next = replies.shift();
    if (next === undefined) throw new Error("no more canned replies");
    return next;
  };
  return { complete, calls };
}

describe("parseAnnotationReply", () => {
  const ids = ["ch3.s1", "ch3.s2"];

  it("repairs case, strings for numbers, empty words and out-of-range values", () => {
    const result = parseAnnotationReply(`<think>hmm</think>\n\`\`\`json\n${reply([
      { ...goodScene1, outcome: "Success", valueEnd: { axis: "safety", value: 5 }, stakes: 14 },
      { ...goodScene2, id: "CH3.S2", turningPoint: { description: "x", causedBy: "chance", evidence: "The tide came in" } },
    ])}\n\`\`\``, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [one, two] = result.scenes;
    expect(one).toMatchObject({ id: "ch3.s1", outcome: "success", valueStart: { axis: "safety", value: -1 }, valueEnd: { value: 2 }, stakes: 10 });
    expect(two).toMatchObject({ id: "ch3.s2", goal: null, opposition: null, stakes: 2, turningPoint: { causedBy: "circumstance" } });
  });

  it("takes a bare array and assigns ids in order when the model leaves them out", () => {
    const result = parseAnnotationReply(JSON.stringify([{ ...goodScene1, id: undefined }, { ...goodScene2, id: undefined }]), ids);
    expect(result.ok && result.scenes.map((scene) => scene.id)).toEqual(ids);
  });

  it("reports a reply with no JSON, no scenes or no known id", () => {
    expect(parseAnnotationReply("I cannot help with that.", ids)).toMatchObject({ ok: false, error: "the reply has no JSON object" });
    expect(parseAnnotationReply("{\"notes\": 1}", ids)).toMatchObject({ ok: false });
    expect(parseAnnotationReply(reply([{ ...goodScene1, id: "ch9.s9" }]), ids)).toMatchObject({ ok: false });
  });
});

describe("annotateChapter", () => {
  it("annotates each scene, keeps located quotes as written and drops the rest", async () => {
    const model = fake(reply([goodScene1, goodScene2]));
    const result = await annotateChapter(3, CHAPTER, model.complete, { annotator: "llm@test-model" });
    expect(result.annotated).toEqual(["ch3.s1", "ch3.s2"]);
    expect(result.calls).toBe(1);
    const [one, two] = result.scenes;
    // The opposition quote had straight quotes; the stored passage is the author's text.
    expect(one!.evidence.opposition).toBe("\"Nobody goes in tonight,\" he said.");
    expect(one!.turningPoint?.evidence).toBe("She lied about the harbour master's order, and he stepped aside.");
    expect(one!.annotator).toBe("llm@test-model");
    // The invented POV-break quote is not in the scene, so the break is dropped.
    expect(two!.povBreaks).toBeUndefined();
    expect(two!.evidence.outcome).toBe("The tide came in and covered the lower steps");
    expect(result.quotes).toEqual({ given: 6, located: 5 });
    expect(() => SceneAnnotationSchema.parse(one)).not.toThrow();
  });

  it("only locates quotes inside their own scene", async () => {
    const wrongScene = { ...goodScene2, evidence: { outcome: "Mira wanted the ledger before the customs men came back." } };
    const result = await annotateChapter(3, CHAPTER, fake(reply([goodScene1, wrongScene])).complete, { annotator: "llm@test-model" });
    expect(result.scenes[1]!.evidence).toEqual({});
  });

  it("drops a turning point whose evidence is not in the text", async () => {
    const invented = { ...goodScene1, turningPoint: { ...goodScene1.turningPoint, evidence: "Mira kicked the door down and ran inside screaming." } };
    const result = await annotateChapter(3, CHAPTER, fake(reply([invented, goodScene2])).complete, { annotator: "llm@test-model" });
    expect(result.scenes[0]!.turningPoint).toBeNull();
  });

  it("retries once with the problem when the reply is unusable", async () => {
    const model = fake("Sure! Here are the scenes.", reply([goodScene1, goodScene2]));
    const result = await annotateChapter(3, CHAPTER, model.complete, { annotator: "llm@test-model" });
    expect(result.calls).toBe(2);
    expect(model.calls[1]!.at(-1)!.content).toContain("could not be used: the reply has no JSON object");
    await expect(annotateChapter(3, CHAPTER, fake("no", "still no").complete, { annotator: "llm@test-model" }))
      .rejects.toThrow("after 2 attempts");
  });

  it("skips unchanged scenes, re-annotates edited ones, and never touches the author's", async () => {
    const first = await annotateChapter(3, CHAPTER, fake(reply([goodScene1, goodScene2])).complete, { annotator: "llm@test-model" });
    const again = fake();
    const unchanged = await annotateChapter(3, CHAPTER, again.complete, { annotator: "llm@test-model", existing: first.scenes });
    expect(unchanged.calls).toBe(0);
    expect(unchanged.kept).toEqual(["ch3.s1", "ch3.s2"]);

    const edited = CHAPTER.replace("he did not move", "he went home");
    const authored = first.scenes.map((entry) => (entry.id === "ch3.s1" ? { ...entry, annotator: "author", goal: "find her mother's name" } : entry));
    const model = fake(reply([{ ...goodScene2, stakes: 4 }]));
    const result = await annotateChapter(3, edited, model.complete, { annotator: "llm@test-model", existing: authored, force: true });
    expect(model.calls[0]![1]!.content).toContain("Scenes to annotate: ch3.s2");
    expect(result.annotated).toEqual(["ch3.s2"]);
    expect(result.scenes[0]).toMatchObject({ annotator: "author", goal: "find her mother's name" });
    expect(result.scenes[1]!.stakes).toBe(4);
  });

  it("marks scene boundaries in the prompt and writes a Chinese prompt for a Chinese chapter", () => {
    const scenes = segmentScenes(CHAPTER, { chapter: 3 });
    const [, user] = annotationPrompt(3, CHAPTER, scenes, ["ch3.s1", "ch3.s2"], { protagonist: "Mira" });
    expect(user!.content).toContain("=== SCENE ch3.s1 ===\nMira wanted");
    expect(user!.content).toContain("=== SCENE ch3.s2 ===\nTomas waited");
    expect(user!.content).toContain("The protagonist: Mira");

    const zh = "# 第三章\n\n林默想在天亮前拿到账本。他推开门，看见守卫已经睡着了。\n";
    expect(detectLanguage(zh)).toBe("zh");
    const [system] = annotationPrompt(3, zh, segmentScenes(zh, { chapter: 3 }), ["ch3.s1"]);
    expect(system!.content).toContain("只回复一个 JSON 对象");
  });
});

describe("scene annotation files", () => {
  const entry = (id: string, annotator: string, goal: string | null = null): SceneAnnotation => SceneAnnotationSchema.parse({
    id, chapter: Number(id.slice(2, id.indexOf("."))), scene: Number(id.slice(id.indexOf(".s") + 2)), goal, annotator,
  });

  it("fills defaults for a hand-written entry and rejects a mismatched id", () => {
    const parsed = SceneAnnotationsFileSchema.parse({ version: 1, scenes: [{ id: "ch1.s1", chapter: 1, scene: 1, annotator: "author", goal: "escape" }] });
    expect(parsed.scenes[0]).toMatchObject({ pov: null, opposition: null, stakes: null, evidence: {} });
    expect(SceneAnnotationSchema.safeParse({ id: "ch1.s2", chapter: 1, scene: 1, annotator: "author" }).success).toBe(false);
    expect(SceneAnnotationSchema.safeParse({ id: "ch1.s1", chapter: 1, scene: 1, annotator: "gpt" }).success).toBe(false);
  });

  it("merges with the author's entries winning", () => {
    const merged = mergeSceneAnnotations(
      [entry("ch1.s1", "author", "mine"), entry("ch1.s2", "llm@a"), entry("ch1.s3", "llm@a"), entry("ch2.s1", "llm@a")],
      [entry("ch1.s1", "llm@b", "theirs"), entry("ch1.s2", "llm@b", "new")],
      [1],
    );
    expect(merged.map((scene) => [scene.id, scene.annotator, scene.goal])).toEqual([
      ["ch1.s1", "author", "mine"], ["ch1.s2", "llm@b", "new"], ["ch2.s1", "llm@a", null],
    ]);
  });

  it("hashes scene prose ignoring line endings, and finds stale entries", async () => {
    expect(sceneHash("a\r\nb\n")).toBe(sceneHash("a\nb"));
    expect(sceneHash("a\nb")).not.toBe(sceneHash("a\nc"));
    const result = await annotateChapter(3, CHAPTER, fake(reply([goodScene1, goodScene2])).complete, { annotator: "llm@test-model" });
    const file = SceneAnnotationsFileSchema.parse({ version: 1, scenes: result.scenes });
    expect(staleSceneAnnotations(file, new Map([[3, CHAPTER]]))).toEqual([]);
    expect(staleSceneAnnotations(file, new Map([[3, CHAPTER.replace("tide", "sea")]])).map((scene) => scene.id)).toEqual(["ch3.s2"]);
  });

  it("locates a quote within its scene in today's text", () => {
    const span = locateSceneQuote({ id: "ch3.s2", chapter: 3 }, "covered the lower steps", new Map([[3, CHAPTER]]));
    expect(span && CHAPTER.slice(span.start, span.end)).toBe("covered the lower steps");
    expect(locateSceneQuote({ id: "ch3.s2", chapter: 3 }, "not there at all", new Map([[3, CHAPTER]]))).toBeNull();
  });

  it("is read by the node loader", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plotlint-scenes-"));
    try {
      await mkdir(join(dir, "story", "plotlint"), { recursive: true });
      await writeFile(join(dir, "story", "plotlint", "scenes.json"), JSON.stringify({ version: 1, protagonist: "Mira", scenes: [entry("ch1.s1", "author")] }));
      const book = await loadBookRuleData(dir);
      expect(book.scenes?.protagonist).toBe("Mira");
      expect(book.scenes?.scenes).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
