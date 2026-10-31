#!/usr/bin/env node
// Make (or remake) a small test project for trying plotlint in Studio, with no
// LLM needed: one English book of three chapters with a typo, clichés, a dead
// character who acts again, scene breaks, scene annotations that the structure
// checks flag, and an agent revision waiting for review as tracked changes.
//
//   node scripts/demo-book.mjs [project-dir]    (default: .plotlint-demo in the repo)
//
// Needs a build first (`pnpm build`). Running it again resets the book.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = resolve(process.argv[2] ?? join(repo, ".plotlint-demo"));
const cliEntry = join(repo, "packages", "cli", "dist", "index.js");
const coreEntry = join(repo, "packages", "core", "dist", "index.js");
if (!existsSync(cliEntry) || !existsSync(coreEntry)) {
  console.error("Build first: pnpm build");
  process.exit(1);
}
const { StateManager, archiveChapterVersion, saveRuntimeStateSnapshot } = await import(pathToFileURL(coreEntry).href);

const BOOK = "harbour-lights";
const now = new Date().toISOString();

const chapters = [
  {
    title: "The Lamp",
    text: `# Chapter 1: The Lamp

Mira Vale climbed the lighthouse stairs at the crack of dawn. The lamp had gone out in the night, and the harbour below was dark as night.

She found the brass key where Pell had left it, under the third step. Her heart was pounding in her chest as she turned it in the lock.

* * *

Captain Harrow was waiting on the quay when she came down. "You're late," he said.

"The lamp went out," Mira said. "Somebody wanted the ships to miss the channel."
`,
  },
  {
    title: "Low Water",
    text: `# Chapter 2: Low Water

The storm came in fast. Mira went out on the rocks to light the signal fire, and the sea took her before Harrow could reach the end of the pier.

They searched until the tide turned. At the end of the day, all they found was her lantern, wedged between two stones.

* * *

Harrow kept the brass key. He did not tell the others what he had seen on the rocks: a second figure, standing very still, watching Mira fall.
`,
  },
  {
    title: "The Signal",
    text: `# Chapter 3: The Signal

Three days later, Mira walked into the harbour office and set the lantern on Harrow's desk.

"You kept my key," she said. Harrow could not speak. The colour drained from his face.

* * *

That night the lamp burned again, and every ship found the channel. Pell watched it from the quay and smiled, and nobody could explain teh light.
`,
  },
];

// The revision an agent made to chapter 3, so Studio offers "Review changes".
const BEFORE_REVISION = chapters[2].text
  .replace("Three days later, Mira walked into", "Three days later, Mira came into")
  .replace("Harrow could not speak. The colour drained from his face.", "Harrow said nothing.");

const fact = (subject, predicate, object, chapter, extra = {}) => ({
  subject, predicate, object, validFromChapter: chapter, validUntilChapter: null, sourceChapter: chapter, ...extra,
});

if (!existsSync(join(projectDir, "inkos.json"))) {
  await mkdir(projectDir, { recursive: true });
  execFileSync(process.execPath, [cliEntry, "init", "--lang", "en"], { cwd: projectDir, stdio: "inherit" });
}

const state = new StateManager(projectDir);
const bookDir = state.bookDir(BOOK);
await rm(bookDir, { recursive: true, force: true });
await state.saveBookConfig(BOOK, {
  id: BOOK, title: "Harbour Lights", platform: "other", genre: "mystery", status: "active",
  targetChapters: 12, chapterWordCount: 2000, language: "en", createdAt: now, updatedAt: now,
});

await mkdir(join(bookDir, "chapters"), { recursive: true });
const index = [];
for (const [i, chapter] of chapters.entries()) {
  const number = i + 1;
  const file = `${String(number).padStart(4, "0")}_${chapter.title.replace(/\s+/g, "_")}.md`;
  await writeFile(join(bookDir, "chapters", file), chapter.text);
  index.push({
    number, title: chapter.title, wordCount: chapter.text.split(/\s+/).filter(Boolean).length,
    createdAt: now, updatedAt: now, observations: [], provenance: "imported",
  });
}
await state.saveChapterIndex(BOOK, index);

await saveRuntimeStateSnapshot(bookDir, {
  manifest: { schemaVersion: 2, language: "en", lastAppliedChapter: 3, projectionVersion: 1 },
  currentState: {
    chapter: 3,
    facts: [
      fact("Mira Vale", "status", "alive", 1, { validUntilChapter: 1 }),
      fact("Mira Vale", "holds", "brass key", 1, { validUntilChapter: 1 }),
      fact("Captain Harrow", "location", "the quay", 1),
      fact("Mira Vale", "status", "dead", 2),
      fact("Captain Harrow", "holds", "brass key", 2),
      fact("Mira Vale", "location", "harbour office", 3),
      fact("Pell", "location", "the quay", 3),
    ],
  },
  hooks: {
    hooks: [
      { hookId: "lamp", startChapter: 1, type: "mystery", status: "open", lastAdvancedChapter: 1, expectedPayoff: "Who put out the lamp", notes: "" },
      { hookId: "figure", startChapter: 2, type: "mystery", status: "open", lastAdvancedChapter: 2, expectedPayoff: "Who watched Mira fall", notes: "" },
    ],
  },
  chapterSummaries: { rows: [] },
});

// Scene annotations, as `inkos lint annotate` would write them with an LLM.
const flat = { valueStart: { axis: "safety", value: 0 }, valueEnd: { axis: "safety", value: 0 } };
const scene = (chapter, n, extra = {}) => ({
  id: `ch${chapter}.s${n}`, chapter, scene: n, pov: "Mira Vale", goal: "relight the lamp", opposition: "the storm",
  annotator: "author", ...flat, ...extra,
});
await mkdir(join(bookDir, "story", "plotlint"), { recursive: true });
await writeFile(join(bookDir, "story", "plotlint", "scenes.json"), JSON.stringify({
  version: 1,
  scenes: [
    scene(1, 1, { valueEnd: { axis: "safety", value: -1 } }),
    scene(1, 2, { pov: "Captain Harrow", goal: null, opposition: null }),
    scene(2, 1, { valueEnd: { axis: "safety", value: -2 } }),
    scene(2, 2, { pov: "Captain Harrow", goal: "keep the secret", opposition: null }),
    scene(3, 1, { goal: "confront Harrow", opposition: "Harrow" }),
    scene(3, 2, { pov: "Pell", goal: null, opposition: null }),
  ],
}, null, 2));

await archiveChapterVersion(bookDir, 3, BEFORE_REVISION, "revision");

console.log(`Test book "Harbour Lights" is ready in ${projectDir}`);
