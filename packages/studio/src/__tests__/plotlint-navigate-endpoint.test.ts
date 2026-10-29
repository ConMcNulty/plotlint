import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager, saveRuntimeStateSnapshot, type CurrentStateFact } from "@actalk/inkos-core";
import { createStudioServer } from "../api/server.js";

interface Location { chapter: number; start: number; end: number; quote: string; scene?: string }

interface StateResponse {
  chapter: number;
  offset: number;
  stateMissing: boolean;
  entities: Array<{
    subject: string;
    facts: Array<{ fact: CurrentStateFact; kind: string; established?: Location; unanchored?: boolean }>;
  }>;
}

interface DefinitionResponse {
  name: string;
  stateMissing: boolean;
  definitions: Array<{ entity: string; role: "subject" | "object"; fact: CurrentStateFact; location: Location }>;
}

const BOOK = "harbour-book";

const CHAPTER_1 = [
  "# Chapter 1",
  "",
  "Mira Vale stepped off the ferry at the north pier with the brass key in her fist.",
  "",
  "Captain Harrow was waiting by the bollards.",
].join("\n");

const CHAPTER_2 = [
  "# Chapter 2",
  "",
  "The fog thinned before dawn.",
  "",
  "By noon Mira had climbed to the lantern house, the key still warm in her pocket.",
  "",
  "Harrow lay dead at the foot of the stair.",
].join("\n");

const fact = (
  subject: string, predicate: string, object: string, from: number, until: number | null,
  extra: Partial<CurrentStateFact> = {},
): CurrentStateFact => ({ subject, predicate, object, validFromChapter: from, validUntilChapter: until, sourceChapter: from, ...extra });

const FACTS: CurrentStateFact[] = [
  fact("Mira Vale", "location", "north pier", 1, 1, {
    kind: "location",
    evidence: { quote: "stepped off the ferry at the north pier" },
    endEvidence: { quote: "Mira had climbed to the lantern house" },
  }),
  fact("Mira Vale", "holds", "brass key", 1, null, { kind: "possession", evidence: { quote: "with the brass key in her fist" } }),
  fact("Mira Vale", "location", "lantern house", 2, null, { kind: "location", evidence: { quote: "Mira had climbed to the lantern house" } }),
  fact("Captain Harrow", "status", "dead", 2, null, { kind: "status", evidence: { quote: "Harrow lay dead at the foot of the stair" } }),
  // Cited, but the passage is not in the chapter.
  fact("Captain Harrow", "mood", "grim", 2, null, { kind: "trait", evidence: { quote: "his face was grim" } }),
];

describe("plotlint navigation endpoints", () => {
  let root: string;
  let bookDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-studio-plotlint-nav-"));
    bookDir = new StateManager(root).bookDir(BOOK);
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0001_Arrival.md"), CHAPTER_1, "utf-8");
    await writeFile(join(bookDir, "chapters", "0002_Lantern.md"), CHAPTER_2, "utf-8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const post = async (route: "state" | "definition" | "references", body: Record<string, unknown>) => {
    const app = createStudioServer({} as never, root);
    return app.request(`/api/v1/plotlint/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };
  const stateAt = async (body: Record<string, unknown>) => (await (await post("state", { bookId: BOOK, ...body })).json()) as StateResponse;
  const definition = async (body: Record<string, unknown>) => (await (await post("definition", { bookId: BOOK, ...body })).json()) as DefinitionResponse;

  const saveState = () => saveRuntimeStateSnapshot(bookDir, {
    manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 2, projectionVersion: 1 },
    currentState: { chapter: 2, facts: FACTS },
    hooks: { hooks: [] },
    chapterSummaries: { rows: [] },
  });

  const predicates = (json: StateResponse, subject: string) =>
    json.entities.find((entity) => entity.subject === subject)?.facts.map(({ fact }) => `${fact.predicate}=${fact.object}`) ?? [];

  it("reports the world as of the cursor, with where each fact was established", async () => {
    await saveState();
    const climb = CHAPTER_2.indexOf("Mira had climbed");

    const before = await stateAt({ chapter: 2, offset: climb - 1 });
    expect(before.stateMissing).toBe(false);
    // Facts sort by kind (location before possession), then predicate.
    expect(predicates(before, "Mira Vale")).toEqual(["location=north pier", "holds=brass key"]);
    const pier = before.entities[1]!.facts.find(({ fact }) => fact.object === "north pier")!;
    expect(pier.kind).toBe("location");
    expect(pier.established).toMatchObject({ chapter: 1, quote: "stepped off the ferry at the north pier", scene: "ch1.s1" });
    expect(CHAPTER_1.slice(pier.established!.start, pier.established!.end)).toBe("stepped off the ferry at the north pier");
    // Harrow's facts start later in the chapter.
    expect(predicates(before, "Captain Harrow")).toEqual(["mood=grim"]);
    expect(before.entities[0]!.facts[0]).toMatchObject({ unanchored: true });

    const after = await stateAt({ chapter: 2, offset: CHAPTER_2.length });
    expect(predicates(after, "Mira Vale")).toEqual(["location=lantern house", "holds=brass key"]);
    expect(predicates(after, "Captain Harrow")).toEqual(["status=dead", "mood=grim"]);
    const dead = after.entities[0]!.facts.find(({ fact }) => fact.object === "dead")!;
    expect(CHAPTER_2.slice(dead.established!.start, dead.established!.end)).toBe("Harrow lay dead at the foot of the stair");
  });

  it("reads the open chapter's unsaved text instead of its file", async () => {
    await saveState();
    const edited = CHAPTER_2.replace("The fog thinned before dawn.", "The fog thinned before dawn, and the gulls went quiet one by one.");
    const json = await stateAt({ chapter: 2, offset: edited.length, text: edited });
    const dead = json.entities[0]!.facts.find(({ fact }) => fact.object === "dead")!;
    expect(dead.established!.start).toBe(edited.indexOf("Harrow lay dead"));
    expect(dead.established!.start).not.toBe(CHAPTER_2.indexOf("Harrow lay dead"));
  });

  it("finds where a name is first established, then later facts about it", async () => {
    await saveState();
    const json = await definition({ name: "Mira Vale" });
    expect(json.definitions.map(({ location }) => [location.chapter, location.quote])).toEqual([
      [1, "stepped off the ferry at the north pier"],
      [1, "with the brass key in her fist"],
      [2, "Mira had climbed to the lantern house"],
    ]);
    expect(json.definitions[0]).toMatchObject({ entity: "Mira Vale", role: "subject" });

    // Objects resolve too, and case does not matter.
    const key = await definition({ name: "Brass Key" });
    expect(key.definitions).toEqual([expect.objectContaining({ entity: "brass key", role: "object", location: expect.objectContaining({ chapter: 1 }) })]);

    // A fact cited but not in the text has nowhere to jump to.
    expect((await definition({ name: "grim" })).definitions).toEqual([]);
    expect((await definition({ name: "Ysolde" })).definitions).toEqual([]);
  });

  it("resolves a short name to the subject it is part of", async () => {
    await saveState();
    const json = await definition({ name: "Harrow" });
    expect(json.definitions.map(({ entity, location }) => [entity, location.quote])).toEqual([
      ["Captain Harrow", "Harrow lay dead at the foot of the stair"],
    ]);
    expect((await definition({ name: "Vale" })).definitions[0]).toMatchObject({ entity: "Mira Vale", location: { chapter: 1 } });
    // Only whole words: "Val" is not part of a name.
    expect((await definition({ name: "Val" })).definitions).toEqual([]);
  });

  it("locates definitions in the open chapter's unsaved text", async () => {
    await saveState();
    const edited = `${CHAPTER_2}\n\nLater, Harrow lay dead at the foot of the stair, still.`.replace("Harrow lay dead at the foot of the stair.", "Nobody was at the stair.");
    const json = await definition({ name: "captain harrow", chapter: 2, text: edited });
    expect(json.definitions).toHaveLength(1);
    expect(json.definitions[0]!.location.start).toBe(edited.indexOf("Harrow lay dead"));
  });

  it("reports a book without runtime state", async () => {
    const state = await stateAt({ chapter: 1, offset: 0 });
    expect(state).toMatchObject({ stateMissing: true, entities: [] });
    expect(await definition({ name: "Mira Vale" })).toMatchObject({ stateMissing: true, definitions: [] });
  });

  it("finds every reference to the entity a name means, grouped by chapter", async () => {
    await saveState();
    const json = await (await post("references", { bookId: BOOK, name: "Harrow" })).json() as {
      entity: string; names: string[]; total: number; groups: Array<{ chapter: number; hits: Array<{ text: string; start: number; line: number }> }>;
    };
    expect(json).toMatchObject({ entity: "Captain Harrow", names: ["Captain Harrow", "Harrow"], total: 2 });
    expect(json.groups.map((group) => [group.chapter, group.hits.map((hit) => [hit.text, hit.line])])).toEqual([[1, [["Captain Harrow", 5]]], [2, [["Harrow", 7]]]]);
    // The open chapter's unsaved text stands in for its file.
    const edited = await (await post("references", { bookId: BOOK, name: "Mira", chapter: 2, text: "Mira, Mira Vale and Vale." })).json() as { groups: Array<{ chapter: number; hits: unknown[] }> };
    expect(edited.groups.map((group) => [group.chapter, group.hits.length])).toEqual([[1, 1], [2, 3]]);
    expect((await post("references", { bookId: BOOK, name: "" })).status).toBe(400);
  });

  it("rejects bad requests and unknown books", async () => {
    expect((await post("state", { bookId: BOOK, chapter: 1 })).status).toBe(400);
    expect((await post("state", { bookId: BOOK, chapter: 1, offset: -1 })).status).toBe(400);
    expect((await post("state", { bookId: BOOK, chapter: 1, offset: 9, text: "short" })).status).toBe(400);
    expect((await post("state", { bookId: "../etc", chapter: 1, offset: 0 })).status).toBe(400);
    expect((await post("state", { bookId: "missing-book", chapter: 1, offset: 0 })).status).toBe(404);
    expect((await post("definition", { bookId: BOOK, name: "  " })).status).toBe(400);
    expect((await post("definition", { bookId: BOOK, name: "Mira", text: "no chapter" })).status).toBe(400);
    expect((await post("definition", { bookId: "missing-book", name: "Mira" })).status).toBe(404);
  });
});
